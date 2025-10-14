// src/components/CanvasViewport.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Props = { userId: string };

type Shape = {
  id: string;
  created_by: string;
  x: number;
  y: number;
  width: number;
  height: number;
  stroke: string;
  stroke_width: number;
  fill: string | null;
  updated_at?: string;
};

// -------- Canvas config (grid) --------
const GRID_SIZE = 24;
const DOT_RADIUS = 1.5;
const DOT_COLOR = "#9ca3af"; // gray-400

function getTabId() {
  try { return crypto.randomUUID(); }
  catch { return `tab_${Math.random().toString(36).slice(2)}`; }
}

export default function CanvasViewport({ userId }: Props) {
  // ===== World offset (camera) & cursor displacement =====
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState({ dx: 0, dy: 0 });

  // refs that always hold "latest" values (avoid stale closure in rAF/publish)
  const offsetRef = useRef(offset);
  const cursorRef = useRef(cursor);
  useEffect(() => { offsetRef.current = offset; }, [offset]);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  // ===== Supabase presence channel (for tuples on the dashboard) =====
  const tabIdRef = useRef(getTabId());
  const presenceChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const rafRef = useRef<number | null>(null);

  // broadcast presence telemetry (coalesced with rAF)
  const publish = useCallback(() => {
    if (!presenceChRef.current) return;
    const { x, y } = offsetRef.current;
    const { dx, dy } = cursorRef.current;
    presenceChRef.current.send({
      type: "broadcast",
      event: "canvas-meta",
      payload: {
        userId,
        tabId: tabIdRef.current,
        page: "canvas",
        scrollX: Math.round(x),
        scrollY: Math.round(y),
        cursorDX: Math.round(dx),
        cursorDY: Math.round(dy),
        sumX: Math.round(x + dx),
        sumY: Math.round(y + dy),
        at: new Date().toISOString(),
      },
    });
  }, [userId]);

  const schedulePublish = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      publish();
    });
  }, [publish]);

  useEffect(() => {
    const ch = supabase.channel("presence:canvas", { config: { presence: { key: userId } } });
    presenceChRef.current = ch;

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        try { await ch.track({ page: "canvas", tabId: tabIdRef.current, at: new Date().toISOString() }); } catch {}
        publish(); // initial telemetry
      }
    });

    const cleanup = async () => {
      try { await ch.untrack(); } catch {}
      try { await new Promise(r => setTimeout(r, 40)); } catch {}
      try { await ch.unsubscribe(); } catch {}
      try { supabase.removeChannel(ch); } catch {}
    };

    const onPageHide = () => { void cleanup(); };
    const onBeforeUnload = () => { void cleanup(); };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      void cleanup();
    };
  }, [publish, userId]);

  // ===== Cursor displacement relative to viewport center (for tuples) =====
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      setCursor({ dx: e.clientX - cx, dy: e.clientY - cy });
      schedulePublish();
    };
    const onEnter = (e: MouseEvent) => onMove(e);
    const onLeave = () => { setCursor({ dx: 0, dy: 0 }); schedulePublish(); };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseenter", onEnter);
    window.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseenter", onEnter);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, [schedulePublish]);

  // ===== Grid (canvas) =====
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const drawGrid = useCallback(() => {
    const canvas = gridCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear the bitmap in device pixels regardless of transform
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    // Normalize to positive remainders so dots scroll with offset
    const ox = ((-offsetRef.current.x % GRID_SIZE) + GRID_SIZE) % GRID_SIZE;
    const oy = ((-offsetRef.current.y % GRID_SIZE) + GRID_SIZE) % GRID_SIZE;

    ctx.fillStyle = DOT_COLOR;
    for (let y = oy; y <= h; y += GRID_SIZE) {
      for (let x = ox; x <= w; x += GRID_SIZE) {
        ctx.beginPath();
        ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, []);

  // Size grid canvas to container, scale for DPR, and draw
  useEffect(() => {
    const canvas = gridCanvasRef.current;
    if (!canvas) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const resize = () => {
      const w = Math.max(1, canvas.clientWidth);
      const h = Math.max(1, canvas.clientHeight);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawGrid();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    requestAnimationFrame(resize);
    window.addEventListener("resize", resize);
    return () => { ro.disconnect(); window.removeEventListener("resize", resize); };
  }, [drawGrid]);

  // Redraw grid whenever offset changes
  useEffect(() => { drawGrid(); }, [drawGrid, offset.x, offset.y]);

  // ===== Panning input on the root container (wheel + RMB drag) =====
  const panningRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOffset((o) => ({ x: o.x + e.deltaX, y: o.y + e.deltaY }));
    schedulePublish();
  };
  const onMouseDownRoot = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 2) return; // right button only
    panningRef.current = true;
    lastRef.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseMoveRoot = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!panningRef.current) return;
    const dx = e.clientX - lastRef.current.x;
    const dy = e.clientY - lastRef.current.y;
    lastRef.current = { x: e.clientX, y: e.clientY };
    setOffset((o) => ({ x: o.x + dx, y: o.y + dy })); // natural panning
    schedulePublish();
  };
  const onMouseUpRoot = () => { panningRef.current = false; };
  const onContextMenuRoot = (e: React.MouseEvent<HTMLDivElement>) => { e.preventDefault(); };

  // ===== Shapes (shared via Supabase) =====
  const [shapes, setShapes] = useState<Map<string, Shape>>(new Map());

  const upsertShapeLocal = useCallback((s: Shape) => {
    setShapes(prev => {
      const m = new Map(prev);
      m.set(s.id, s);
      return m;
    });
  }, []);
  const removeShapeLocal = useCallback((id: string) => {
    setShapes(prev => {
      const m = new Map(prev);
      m.delete(id);
      return m;
    });
  }, []);

  // Initial load + realtime subscription to public.shapes
  useEffect(() => {
    let active = true;

    (async () => {
      const { data, error } = await supabase
        .from("shapes")
        .select("*")
        .order("updated_at", { ascending: true });
      if (!active) return;
      if (!error && data) {
        setShapes(new Map(data.map((s: any) => [s.id, s as Shape])));
      }
    })();

    const ch = supabase
      .channel("db:shapes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shapes" },
        (msg: any) => {
          const { eventType, new: rowNew, old: rowOld } = msg;
          if (eventType === "INSERT" || eventType === "UPDATE") {
            upsertShapeLocal(rowNew as Shape);
          } else if (eventType === "DELETE") {
            removeShapeLocal(rowOld.id as string);
          }
        }
      )
      .subscribe();

    return () => { try { supabase.removeChannel(ch); } catch {} active = false; };
  }, [upsertShapeLocal, removeShapeLocal]);

  // ===== World <-> Screen helpers =====
  const toWorld = (client: { x: number; y: number }) => ({
    x: client.x + offsetRef.current.x,
    y: client.y + offsetRef.current.y,
  });

  const pickShape = (clientX: number, clientY: number): Shape | null => {
    const { x: wx, y: wy } = toWorld({ x: clientX, y: clientY });
    const arr = Array.from(shapes.values());
    // Top-most hit first (assuming later inserts render on top)
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr[i];
      const minX = Math.min(s.x, s.x + s.width);
      const maxX = Math.max(s.x, s.x + s.width);
      const minY = Math.min(s.y, s.y + s.height);
      const maxY = Math.max(s.y, s.y + s.height);
      if (wx >= minX && wx <= maxX && wy >= minY && wy <= maxY) return s;
    }
    return null;
  };

  // ===== Drag state (create or move) =====
  type DragState =
    | { kind: "none" }
    | { kind: "creating"; start: { x: number; y: number }; ghost: Shape }
    | { kind: "moving"; id: string; grabOffset: { dx: number; dy: number } };

  const [drag, setDrag] = useState<DragState>({ kind: "none" });

  // Throttle DB updates while moving
  const moveRAF = useRef<number | null>(null);
  const scheduleMoveUpdate = (fn: () => void) => {
    if (moveRAF.current != null) return;
    moveRAF.current = requestAnimationFrame(() => {
      moveRAF.current = null;
      fn();
    });
  };

  // ===== Left-drag on SVG: create or move rectangles =====
  const onLeftDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return; // left only
    const picked = pickShape(e.clientX, e.clientY);
    const world = toWorld({ x: e.clientX, y: e.clientY });

    if (picked) {
      // Start moving
      const grabOffset = { dx: world.x - picked.x, dy: world.y - picked.y };
      setDrag({ kind: "moving", id: picked.id, grabOffset });
    } else {
      // Start creating a new rect (ghost)
      const ghost: Shape = {
        id: "ghost",
        created_by: userId,
        x: world.x,
        y: world.y,
        width: 0,
        height: 0,
        stroke: "#000000",
        stroke_width: 2,
        fill: "#ffffff", // white body to occlude grid
      };
      setDrag({ kind: "creating", start: world, ghost });
    }
  }, [userId, shapes]);

  const onLeftMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (drag.kind === "none") return;
    const world = toWorld({ x: e.clientX, y: e.clientY });

    if (drag.kind === "creating") {
      setDrag({
        kind: "creating",
        start: drag.start,
        ghost: { ...drag.ghost, width: world.x - drag.start.x, height: world.y - drag.start.y },
      });
    } else if (drag.kind === "moving") {
      const newX = world.x - drag.grabOffset.dx;
      const newY = world.y - drag.grabOffset.dy;

      // Optimistic local update
      setShapes(prev => {
        const m = new Map(prev);
        const s = m.get(drag.id);
        if (!s) return prev;
        m.set(drag.id, { ...s, x: Math.round(newX), y: Math.round(newY) });
        return m;
      });

      // Persist (anyone can move shapes — your RLS policy allows it)
      scheduleMoveUpdate(async () => {
        await supabase
          .from("shapes")
          .update({ x: Math.round(newX), y: Math.round(newY), updated_at: new Date().toISOString() })
          .eq("id", drag.id);
      });
    }
  }, [drag]);

  const onLeftUp = useCallback(async () => {
    if (drag.kind === "creating") {
      const g = drag.ghost;
      const w = Math.round(g.width);
      const h = Math.round(g.height);
      // Normalize so x,y is top-left and width/height positive
      const nx = Math.round(w >= 0 ? g.x : g.x + w);
      const ny = Math.round(h >= 0 ? g.y : g.y + h);
      const nw = Math.abs(w);
      const nh = Math.abs(h);
      setDrag({ kind: "none" });

      if (nw >= 3 && nh >= 3) {
        const { data, error } = await supabase.from("shapes").insert({
          created_by: userId,
          x: nx, y: ny, width: nw, height: nh,
          stroke: "#000000", stroke_width: 2, fill: "#ffffff",
          updated_at: new Date().toISOString(),
        }).select().single();
        if (!error && data) upsertShapeLocal(data as Shape);
      }
    } else if (drag.kind === "moving") {
      setDrag({ kind: "none" });
    }
  }, [drag, upsertShapeLocal, userId]);

  // ===== Render =====
  return (
    <div
      className="relative w-full h-full overflow-hidden bg-white select-none"
      onWheel={onWheel}
      onMouseDown={onMouseDownRoot}
      onMouseMove={onMouseMoveRoot}
      onMouseUp={onMouseUpRoot}
      onContextMenu={onContextMenuRoot}
    >
      {/* Dot grid (underlay) */}
      <canvas
        ref={gridCanvasRef}
        className="absolute inset-0 block w-full h-full pointer-events-none"
        aria-hidden
      />

      {/* Shapes overlay (SVG) — translated by camera so shapes are in world coords */}
      <svg
        className="absolute inset-0 w-full h-full"
        onMouseDown={onLeftDown}
        onMouseMove={onLeftMove}
        onMouseUp={onLeftUp}
      >
        <g transform={`translate(${-offset.x}, ${-offset.y})`}>
          {Array.from(shapes.values()).map(s => (
            <rect
              key={s.id}
              x={Math.min(s.x, s.x + s.width)}
              y={Math.min(s.y, s.y + s.height)}
              width={Math.abs(s.width)}
              height={Math.abs(s.height)}
              fill={s.fill ?? "#ffffff"}
              stroke={s.stroke}
              strokeWidth={s.stroke_width}
              pointerEvents="all"
              style={{ cursor: "move" }}
            />
          ))}

          {drag.kind === "creating" && (
            <rect
              x={Math.min(drag.ghost.x, drag.ghost.x + drag.ghost.width)}
              y={Math.min(drag.ghost.y, drag.ghost.y + drag.ghost.height)}
              width={Math.abs(drag.ghost.width)}
              height={Math.abs(drag.ghost.height)}
              fill="transparent"
              stroke="#000000"
              strokeWidth={2}
              strokeDasharray="4 3"
              pointerEvents="none"
            />
          )}
        </g>
      </svg>

      {/* Debug HUD (optional) */}
      <div className="absolute bottom-3 left-3 rounded bg-white/80 px-3 py-2 text-xs shadow">
        <div>scroll: ({Math.round(offset.x)}, {Math.round(offset.y)})</div>
        <div>cursorΔ: ({Math.round(cursor.dx)}, {Math.round(cursor.dy)})</div>
        <div>sum: ({Math.round(offset.x + cursor.dx)}, {Math.round(offset.y + cursor.dy)})</div>
        <div className="opacity-60">Wheel pan • RMB drag pan • LMB create/move</div>
      </div>
    </div>
  );
}

