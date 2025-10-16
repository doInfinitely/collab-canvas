// src/components/CanvasViewport.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// deterministic-ish color per user
function colorFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h}, 75%, 45%)`;
}

export default function CanvasViewport({ userId }: Props) {
  // ===== World offset (camera) & cursor displacement =====
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState({ dx: 0, dy: 0 });
  const [screenCursor, setScreenCursor] = useState({ x: 0, y: 0 });

  const [scale, setScale] = useState(1); // world→screen scale
  const scaleRef = useRef(scale);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  // --- Selection state ---
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const clearSelection = () => setSelectedIds(new Set());
  const addToSelection = (id: string) =>
    setSelectedIds((prev) => (prev.has(id) ? prev : new Set([...prev, id])));

  // Multi-drag of selected shapes
  const multiDragRef = useRef<null | {
    startMouseX: number;
    startMouseY: number;
    starts: Array<{ id: string; x: number; y: number }>;
  }>(null);

  // Marquee (shift-drag box) in WORLD coordinates
  const [marquee, setMarquee] = useState<null | {
    startX: number; startY: number; curX: number; curY: number;
  }>(null);

  // helpers
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const toWorld = (client: { x: number; y: number }) => ({
    x: offsetRef.current.x + client.x / scaleRef.current,
    y: offsetRef.current.y + client.y / scaleRef.current,
  });

  // refs mirror latest values to avoid stale closures in rAF/broadcasts
  const offsetRef = useRef(offset);
  const cursorRef = useRef(cursor);
  const screenCursorRef = useRef(screenCursor);
  useEffect(() => { offsetRef.current = offset; }, [offset]);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => { screenCursorRef.current = screenCursor; }, [screenCursor]);

  // ===== Supabase presence channel (for tuples & remote cursors) =====
  const tabIdRef = useRef(getTabId());
  const presenceChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const rafRef = useRef<number | null>(null);

  // email lookup (profiles)
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("id,email");
      if (data) setProfiles(new Map(data.map((r) => [r.id as string, (r.email as string) ?? ""])));
    })();
  }, []);

  // --- remote cursors state (latest world coords per user) ---
  type RemoteCursor = { worldX: number; worldY: number; at: number };
  const [remoteCursors, setRemoteCursors] = useState<Map<string, RemoteCursor>>(new Map());

  // prune stale cursors (no update in 4s)
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setRemoteCursors((prev) => {
        const m = new Map(prev);
        for (const [uid, rc] of m) {
          if (now - rc.at > 4000) m.delete(uid);
        }
        return m;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // broadcast presence telemetry (coalesced with rAF)
  const publish = useCallback(() => {
    if (!presenceChRef.current) return;
    const { x: cx, y: cy } = screenCursorRef.current;
    const worldUnderCursorX = offsetRef.current.x + cx / scaleRef.current;
    const worldUnderCursorY = offsetRef.current.y + cy / scaleRef.current;
    presenceChRef.current.send({
      type: "broadcast",
      event: "canvas-meta",
      payload: {
        userId,
        tabId: tabIdRef.current,
        page: "canvas",
        scrollX: Math.round(offsetRef.current.x),
        scrollY: Math.round(offsetRef.current.y),
        cursorDX: Math.round(cursorRef.current.dx),
        cursorDY: Math.round(cursorRef.current.dy),
        sumX: Math.round(offsetRef.current.x + cursorRef.current.dx),
        sumY: Math.round(offsetRef.current.y + cursorRef.current.dy),
        cursorWorldX: Math.round(worldUnderCursorX),
        cursorWorldY: Math.round(worldUnderCursorY),
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

    // receive others' telemetry for cursor rendering
    ch.on("broadcast", { event: "canvas-meta" }, ({ payload }) => {
      const p = payload as {
        userId: string;
        cursorWorldX?: number;
        cursorWorldY?: number;
        at?: string;
        page?: string;
      };
      if (!p || !p.userId || p.userId === userId) return;
      if (p.page !== "canvas") return;
      if (typeof p.cursorWorldX !== "number" || typeof p.cursorWorldY !== "number") return;
      setRemoteCursors((prev) => {
        const m = new Map(prev);
        m.set(p.userId, {
          worldX: p.cursorWorldX!,
          worldY: p.cursorWorldY!,
          at: p.at ? Date.parse(p.at) : Date.now(),
        });
        return m;
      });
    });

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        try {
          await ch.track({ page: "canvas", tabId: tabIdRef.current, at: new Date().toISOString() });
        } catch {}
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
      setScreenCursor({ x: e.clientX, y: e.clientY });
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

    // Clear
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const s = scaleRef.current;

    // compute screen-space spacing/offset
    const spacing = GRID_SIZE * s;
    if (spacing < 4) return; // too dense—skip for perf/clarity

    const ox = ((-offsetRef.current.x * s) % spacing + spacing) % spacing;
    const oy = ((-offsetRef.current.y * s) % spacing + spacing) % spacing;

    ctx.fillStyle = DOT_COLOR;
    const r = Math.max(1, DOT_RADIUS * s * 0.9); // scale dot radius a bit
    for (let y = oy; y <= h; y += spacing) {
      for (let x = ox; x <= w; x += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
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

  // --- Panning (root) ---
  const panningRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });

  const onMouseDownRoot = (e: React.MouseEvent<HTMLDivElement>) => {
    // Right mouse button starts panning; leave LMB behavior unchanged
    if (e.button !== 2) return;
    panningRef.current = true;
    lastRef.current = { x: e.clientX, y: e.clientY };
  };

  const onMouseMoveRoot = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!panningRef.current) return;
    // Keep pan speed consistent at any zoom
    const dx = (e.clientX - lastRef.current.x) / scaleRef.current;
    const dy = (e.clientY - lastRef.current.y) / scaleRef.current;
    lastRef.current = { x: e.clientX, y: e.clientY };
    setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
    schedulePublish();
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // Pinch/zoom
      const zoomIntensity = 0.0015;
      const old = scaleRef.current;
      const next = Math.min(4, Math.max(0.2, old * Math.exp(-e.deltaY * zoomIntensity)));

      // Keep the point under the cursor fixed
      const cx = e.clientX, cy = e.clientY;
      const worldX = offsetRef.current.x + cx / old;
      const worldY = offsetRef.current.y + cy / old;

      setScale(next);
      setOffset({ x: worldX - cx / next, y: worldY - cy / next });
    } else {
      // Normal wheel pans (scale-aware so speed feels the same)
      setOffset((o) => ({
        x: o.x + e.deltaX / scaleRef.current,
        y: o.y + e.deltaY / scaleRef.current,
      }));
    }

    schedulePublish();
  };

  const onMouseUpRoot = () => { panningRef.current = false; };
  const onContextMenuRoot = (e: React.MouseEvent<HTMLDivElement>) => { e.preventDefault(); };

  // ===== Shapes (shared via Supabase) =====
  const [shapes, setShapes] = useState<Map<string, Shape>>(new Map());
  const shapeList = useMemo(() => Array.from(shapes.values()), [shapes]);

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

  // Live-sync channel for shapes (broadcast fan-out)
  const shapesChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => {
    const ch = supabase.channel("broadcast:shapes", { config: { broadcast: { self: false } } });
    shapesChRef.current = ch;

    ch.on("broadcast", { event: "shape-create" }, ({ payload }: { payload: Shape }) => {
      upsertShapeLocal(payload as Shape);
    });

    ch.on("broadcast", { event: "shape-move" }, ({ payload }: { payload: { id: string; x: number; y: number; updated_at?: string } }) => {
      setShapes(prev => {
        const m = new Map(prev);
        const s = m.get(payload.id);
        if (!s) return prev;
        m.set(payload.id, { ...s, x: Math.round(payload.x), y: Math.round(payload.y), updated_at: payload.updated_at ?? s.updated_at });
        return m;
      });
    });

    ch.on("broadcast", { event: "shape-delete" }, ({ payload }: { payload: { id: string } }) => {
      removeShapeLocal(payload.id);
    });

    ch.subscribe();

    return () => {
      try { ch.unsubscribe(); } catch {}
      try { supabase.removeChannel(ch); } catch {}
      shapesChRef.current = null;
    };
  }, [upsertShapeLocal, removeShapeLocal]);

  // Initial load from DB
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("shapes")
        .select("*")
        .order("updated_at", { ascending: true });

      if (!active || !data) return;

      const rows = data as unknown as Shape[];
      setShapes(new Map(rows.map((s) => [s.id, s])));
    })();
    return () => { active = false; };
  }, []);

  const pickShape = useCallback((clientX: number, clientY: number): Shape | null => {
    const { x: wx, y: wy } = toWorld({ x: clientX, y: clientY });
    const arr = Array.from(shapes.values());
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr[i];
      const minX = Math.min(s.x, s.x + s.width);
      const maxX = Math.max(s.x, s.x + s.width);
      const minY = Math.min(s.y, s.y + s.height);
      const maxY = Math.max(s.y, s.y + s.height);
      if (wx >= minX && wx <= maxX && wy >= minY && wy <= maxY) return s;
    }
    return null;
  }, [shapes]);

  // ===== Drag state (create / move) =====
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

  // ===== Left-drag on SVG: selection + create/move rectangles =====
  const onLeftDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return; // left only
    const picked = pickShape(e.clientX, e.clientY);
    const world = toWorld({ x: e.clientX, y: e.clientY });

    // Background
    if (!picked) {
      if (e.shiftKey) {
        // Start marquee selection on background
        setMarquee({ startX: world.x, startY: world.y, curX: world.x, curY: world.y });
        return;
      } else {
        // Click background clears selection, then proceed with your existing creation gesture
        clearSelection();
        const ghost: Shape = {
          id: "ghost",
          created_by: userId,
          x: world.x,
          y: world.y,
          width: 0,
          height: 0,
          stroke: "#000000",
          stroke_width: 2,
          fill: "#ffffff",
        };
        setDrag({ kind: "creating", start: world, ghost });
        return;
      }
    }

    // Clicked on a shape
    if (e.shiftKey) {
      // Shift+click selects (adds), no drag
      addToSelection(picked.id);
      return;
    }

    // If the clicked shape is already selected, prepare to multi-drag all selected
    if (selectedIds.has(picked.id)) {
      multiDragRef.current = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        starts: [...selectedIds]
          .map((sid) => shapes.get(sid))
          .filter(Boolean)
          .map((s) => ({ id: s!.id, x: s!.x, y: s!.y })),
      };
      return;
    }

    // Otherwise: start your existing single-shape move
    const grabOffset = { dx: world.x - picked.x, dy: world.y - picked.y };
    setDrag({ kind: "moving", id: picked.id, grabOffset });
  }, [userId, shapes, pickShape, selectedIds]);

  const onLeftMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const world = toWorld({ x: e.clientX, y: e.clientY });

    // Update marquee
    if (marquee) {
      setMarquee(m => (m ? { ...m, curX: world.x, curY: world.y } : m));
      return;
    }

    // Multi-drag: move all selected by the same delta
    if (multiDragRef.current) {
      const dx = (e.clientX - multiDragRef.current.startMouseX) / scaleRef.current;
      const dy = (e.clientY - multiDragRef.current.startMouseY) / scaleRef.current;

      // Optimistic local update for all selected
      setShapes(prev => {
        const m = new Map(prev);
        for (const { id, x, y } of multiDragRef.current!.starts) {
          const s = m.get(id);
          if (!s) continue;
          m.set(id, { ...s, x: Math.round(x + dx), y: Math.round(y + dy), updated_at: new Date().toISOString() });
        }
        return m;
      });

      // Broadcast + schedule persist for all selected
      for (const { id, x, y } of multiDragRef.current.starts) {
        const nx = Math.round(x + dx);
        const ny = Math.round(y + dy);
        shapesChRef.current?.send({
          type: "broadcast",
          event: "shape-move",
          payload: { id, x: nx, y: ny, updated_at: new Date().toISOString() },
        });
        scheduleMoveUpdate(async () => {
          await supabase.from("shapes").update({ x: nx, y: ny, updated_at: new Date().toISOString() }).eq("id", id);
        });
      }
      return;
    }

    // Your existing single-shape create/move
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

      // Live broadcast so others update immediately
      shapesChRef.current?.send({
        type: "broadcast",
        event: "shape-move",
        payload: {
          id: drag.id,
          x: Math.round(newX),
          y: Math.round(newY),
          updated_at: new Date().toISOString(),
        },
      });

      // Persist (DB) for refresh resilience
      scheduleMoveUpdate(async () => {
        await supabase
          .from("shapes")
          .update({ x: Math.round(newX), y: Math.round(newY), updated_at: new Date().toISOString() })
          .eq("id", drag.id);
      });
    }
  }, [drag, marquee]);

  const onLeftUp = useCallback(async () => {
    // Finalize marquee → select all fully inside
    if (marquee) {
      const { startX, startY, curX, curY } = marquee;
      const minX = Math.min(startX, curX), maxX = Math.max(startX, curX);
      const minY = Math.min(startY, curY), maxY = Math.max(startY, curY);
      const inside = [...shapes.values()]
        .filter(s =>
          s.x >= minX && s.y >= minY &&
          s.x + s.width  <= maxX &&
          s.y + s.height <= maxY
        )
        .map(s => s.id);
      setSelectedIds(new Set(inside));
      setMarquee(null);
      return;
    }

    // Finish multi-drag: nothing extra to do (we already broadcast + scheduled persists during move)
    if (multiDragRef.current) {
      multiDragRef.current = null;
      return;
    }

    // Your existing single-shape finalize
    if (drag.kind === "creating") {
      const g = drag.ghost;
      const w = Math.round(g.width);
      const h = Math.round(g.height);
      const nx = Math.round(w >= 0 ? g.x : g.x + w);
      const ny = Math.round(h >= 0 ? g.y : g.y + h);
      const nw = Math.abs(w);
      const nh = Math.abs(h);
      setDrag({ kind: "none" });

      if (nw >= 3 && nh >= 3) {
        const id = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `shape_${Math.random().toString(36).slice(2)}`;
        const shape: Shape = {
          id,
          created_by: userId,
          x: nx, y: ny, width: nw, height: nh,
          stroke: "#000000",
          stroke_width: 2,
          fill: "#ffffff",
          updated_at: new Date().toISOString(),
        };

        // Optimistic + broadcast (instant to others)
        upsertShapeLocal(shape);
        shapesChRef.current?.send({ type: "broadcast", event: "shape-create", payload: shape });

        // Persist
        const { error } = await supabase.from("shapes").insert(shape);
        if (error) {
          console.warn("DB insert failed, rolling back local:", error);
          removeShapeLocal(id);
        }
      }
    } else if (drag.kind === "moving") {
      setDrag({ kind: "none" });
    }
  }, [drag, marquee, shapes, userId, upsertShapeLocal, removeShapeLocal]);

  // ===== Double-click delete =====
  const onDoubleClickSVG = useCallback(async (e: React.MouseEvent<SVGSVGElement>) => {
    if (drag.kind !== "none") return;
    const hit = pickShape(e.clientX, e.clientY);
    if (!hit) return;

    removeShapeLocal(hit.id);
    shapesChRef.current?.send({ type: "broadcast", event: "shape-delete", payload: { id: hit.id } });

    const { error } = await supabase.from("shapes").delete().eq("id", hit.id);
    if (error) {
      upsertShapeLocal(hit);
      console.warn("Delete failed:", error.message);
    }
  }, [drag, pickShape, removeShapeLocal, upsertShapeLocal]);

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
        onDoubleClick={onDoubleClickSVG}
      >
        <defs>
          {/* subtle glow for selected shapes */}
          <filter id="selGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#3b82f6" floodOpacity="0.9" />
          </filter>
        </defs>

        <g transform={`translate(${-offset.x * scale}, ${-offset.y * scale}) scale(${scale})`}>
          {shapeList.map((s) => (
            <rect
              key={s.id}
              x={Math.min(s.x, s.x + s.width)}
              y={Math.min(s.y, s.y + s.height)}
              width={Math.abs(s.width)}
              height={Math.abs(s.height)}
              fill={s.fill ?? "#ffffff"}
              stroke={s.stroke}
              strokeWidth={s.stroke_width / scale /* keeps stroke visually constant */}
              pointerEvents="all"
              style={{ cursor: "move" }}
              filter={selectedIds.has(s.id) ? "url(#selGlow)" : undefined}
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
              strokeWidth={2 / scale}
              strokeDasharray={`${4 / scale} ${3 / scale}`}
              pointerEvents="none"
            />
          )}
        </g>

        {/* Marquee overlay (drawn in SCREEN coords for simplicity) */}
        {marquee && (() => {
          const minX = Math.min(marquee.startX, marquee.curX);
          const minY = Math.min(marquee.startY, marquee.curY);
          const maxX = Math.max(marquee.startX, marquee.curX);
          const maxY = Math.max(marquee.startY, marquee.curY);
          const sx = (minX - offset.x) * scaleRef.current;
          const sy = (minY - offset.y) * scaleRef.current;
          const sw = (maxX - minX) * scaleRef.current;
          const sh = (maxY - minY) * scaleRef.current;
          return (
            <rect
              x={sx} y={sy} width={sw} height={sh}
              fill="rgba(59,130,246,0.1)"
              stroke="#3b82f6"
              strokeDasharray="6 4"
              strokeWidth={1}
              pointerEvents="none"
            />
          );
        })()}
      </svg>

      {/* === Multiplayer cursors (screen-space overlay) === */}
      <div className="absolute inset-0 pointer-events-none">
        {Array.from(remoteCursors.entries()).map(([uid, rc]) => {
          const sx = rc.worldX - offsetRef.current.x;
          const sy = rc.worldY - offsetRef.current.y;
          const email = profiles.get(uid) ?? uid.slice(0, 6);
          const color = colorFor(uid);
          return (
            <div
              key={uid}
              className="absolute"
              style={{ transform: `translate(${sx}px, ${sy}px)` }}
            >
              {/* cursor glyph */}
              <svg width="14" height="20" viewBox="0 0 14 20" className="drop-shadow" style={{ display: "block" }}>
                <path d="M1 1 L13 9 L8 10 L9.5 18 L6.5 18 L5 10 L1 9 Z" fill={color} opacity={0.95}/>
                <path d="M1 1 L13 9 L8 10 L9.5 18 L6.5 18 L5 10 L1 9 Z" fill="none" stroke="black" strokeWidth="0.75"/>
              </svg>
              {/* label */}
              <div
                className="mt-[-2px] ml-[10px] rounded px-2 py-0.5 text-[11px] leading-[14px] text-white shadow"
                style={{ backgroundColor: color }}
              >
                {email}
              </div>
            </div>
          );
        })}
      </div>

      {/* Debug HUD (optional) */}
      <div className="absolute bottom-3 left-3 rounded bg-white/80 px-3 py-2 text-xs shadow">
        <div>scroll: ({Math.round(offset.x)}, {Math.round(offset.y)})</div>
        <div>zoom: {scale.toFixed(2)}×</div>
        <div>cursorΔ: ({Math.round(cursor.dx)}, {Math.round(cursor.dy)})</div>
        <div>sum: ({Math.round(offset.x + cursor.dx)}, {Math.round(offset.y + cursor.dy)})</div>
        <div className="opacity-60">
          Wheel pan • RMB drag pan • Ctrl/Cmd+Wheel zoom • LMB create/move • Dbl-click delete • Shift+Click select • Shift+Drag (bg) marquee
        </div>
      </div>
    </div>
  );
}

