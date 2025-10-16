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

type Annotation = {
  id: string;
  shape_id: string;
  user_id: string;
  text: string;
  created_at: string;
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

  // Internal clipboard of shapes (deep copies)
  const clipboardRef = useRef<Shape[] | null>(null);

  // helpers
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const toWorld = (client: { x: number; y: number }) => ({
    x: offsetRef.current.x + client.x / scaleRef.current,
    y: offsetRef.current.y + client.y / scaleRef.current,
  });

  const worldCursor = () => ({
    x: offsetRef.current.x + screenCursorRef.current.x / scaleRef.current,
    y: offsetRef.current.y + screenCursorRef.current.y / scaleRef.current,
  });

  // refs mirror latest values to avoid stale closures in rAF/broadcasts
  const offsetRef = useRef(offset);
  const cursorRef = useRef(cursor);
  const screenCursorRef = useRef(screenCursor);
  const selectedIdsRef = useRef(selectedIds);
  const shapesRef = useRef<Map<string, Shape>>(new Map());
  useEffect(() => { offsetRef.current = offset; }, [offset]);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => { screenCursorRef.current = screenCursor; }, [screenCursor]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

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

  // Debug HUD visibility
  const [showDebug, setShowDebug] = useState(true);

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
  useEffect(() => { shapesRef.current = shapes; }, [shapes]);

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

    // Finish multi-drag
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

  // ===== Double-click delete (delete all if any selected) =====
  const onDoubleClickSVG = useCallback(async (e: React.MouseEvent<SVGSVGElement>) => {
    if (drag.kind !== "none") return;

    const hit = pickShape(e.clientX, e.clientY);
    if (!hit) return;

    const idsToDelete = selectedIds.has(hit.id)
      ? Array.from(selectedIds)
      : [hit.id];

    const toRestore = idsToDelete
      .map((id) => shapesRef.current.get(id))
      .filter(Boolean) as Shape[];

    // Optimistic local remove + broadcast per id
    setShapes(prev => {
      const m = new Map(prev);
      for (const id of idsToDelete) m.delete(id);
      return m;
    });
    for (const id of idsToDelete) {
      shapesChRef.current?.send({ type: "broadcast", event: "shape-delete", payload: { id } });
    }

    const { error } = await supabase.from("shapes").delete().in("id", idsToDelete);
    if (error) {
      console.warn("Batch delete failed:", error.message);
      setShapes(prev => {
        const m = new Map(prev);
        for (const s of toRestore) m.set(s.id, s);
        return m;
      });
    } else {
      setSelectedIds(new Set());
    }
  }, [drag, pickShape, selectedIds]);

  // ====== COPY / CUT / PASTE ======
  // Helper: compute bounding box & center for a list of shapes
  const bboxOf = (items: Shape[]) => {
    if (items.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of items) {
      const x1 = Math.min(s.x, s.x + s.width);
      const y1 = Math.min(s.y, s.y + s.height);
      const x2 = Math.max(s.x, s.x + s.width);
      const y2 = Math.max(s.y, s.y + s.height);
      if (x1 < minX) minX = x1;
      if (y1 < minY) minY = y1;
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
    }
    return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  };

  const doCopy = useCallback(() => {
    const ids = Array.from(selectedIdsRef.current);
    if (ids.length === 0) return;
    const shapesToCopy = ids
      .map((id) => shapesRef.current.get(id))
      .filter(Boolean) as Shape[];
    clipboardRef.current = shapesToCopy.map(s => ({ ...s }));
  }, []);

  const doCut = useCallback(async () => {
    const ids = Array.from(selectedIdsRef.current);
    if (ids.length === 0) return;

    const shapesToCut = ids
      .map((id) => shapesRef.current.get(id))
      .filter(Boolean) as Shape[];

    clipboardRef.current = shapesToCut.map(s => ({ ...s }));

    setShapes(prev => {
      const m = new Map(prev);
      for (const id of ids) m.delete(id);
      return m;
    });
    for (const id of ids) {
      shapesChRef.current?.send({ type: "broadcast", event: "shape-delete", payload: { id } });
    }

    const { error } = await supabase.from("shapes").delete().in("id", ids);
    if (error) {
      console.warn("Cut delete failed:", error.message);
      setShapes(prev => {
        const m = new Map(prev);
        for (const s of shapesToCut) m.set(s.id, s);
        return m;
      });
    }
    setSelectedIds(new Set());
  }, []);

  const doPaste = useCallback(async () => {
    const clip = clipboardRef.current;
    if (!clip || clip.length === 0) return;

    const target = worldCursor();
    const bb = bboxOf(clip);
    if (!bb) return;

    const dx = target.x - bb.cx;
    const dy = target.y - bb.cy;

    const now = new Date().toISOString();
    const newShapes: Shape[] = clip.map((s) => ({
      ...s,
      id: (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `shape_${Math.random().toString(36).slice(2)}`,
      created_by: userId,
      x: Math.round(s.x + dx),
      y: Math.round(s.y + dy),
      updated_at: now,
    }));

    setShapes(prev => {
      const m = new Map(prev);
      for (const s of newShapes) m.set(s.id, s);
      return m;
    });
    for (const s of newShapes) {
      shapesChRef.current?.send({ type: "broadcast", event: "shape-create", payload: s });
    }

    const { error } = await supabase.from("shapes").insert(newShapes);
    if (error) {
      console.warn("Paste insert failed:", error.message);
      setShapes(prev => {
        const m = new Map(prev);
        for (const s of newShapes) m.delete(s.id);
        return m;
      });
      return;
    }

    setSelectedIds(new Set(newShapes.map((s) => s.id)));
  }, [userId]);

  // Global key handler for Cmd/Ctrl + X/C/V
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore if typing in inputs/contenteditable
      const target = e.target as HTMLElement | null;
      if (target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        (target as HTMLElement).isContentEditable
      )) return;

      // Toggle Debug HUD on '?'
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setShowDebug(v => !v);
        return;
      }

      // ===== existing copy/cut/paste below =====
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const k = e.key.toLowerCase();
      if (k === "c") {
        e.preventDefault();
        doCopy();
      } else if (k === "x") {
        e.preventDefault();
        void doCut();
      } else if (k === "v") {
        e.preventDefault();
        void doPaste();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doCopy, doCut, doPaste]);

  // ===== Right-click Properties & Annotations modal =====
  const [modalShapeId, setModalShapeId] = useState<string | null>(null);
  const [annotationInput, setAnnotationInput] = useState("");
  const [annotationsByShape, setAnnotationsByShape] = useState<
    Map<string, Annotation[]>
  >(new Map());

  const annotationsChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // subscribe to annotation broadcasts
  useEffect(() => {
    const ch = supabase.channel("broadcast:annotations", { config: { broadcast: { self: false } } });
    annotationsChRef.current = ch;

    ch.on("broadcast", { event: "annotation-upsert" }, ({ payload }) => {
      const ann = payload as Annotation;
      if (!ann || !ann.shape_id || !ann.text) return;
      setAnnotationsByShape(prev => {
        const m = new Map(prev);
        const curr = m.get(ann.shape_id) ?? [];
        // de-dupe by id
        const idx = curr.findIndex(a => a.id === ann.id);
        if (idx >= 0) curr[idx] = ann; else curr.push(ann);
        m.set(ann.shape_id, [...curr].sort((a,b)=> new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
        return m;
      });
    });

    ch.on("broadcast", { event: "annotation-delete" }, ({ payload }) => {
      const { id, shape_id } = payload as { id: string; shape_id: string };
      if (!id || !shape_id) return;
      setAnnotationsByShape(prev => {
        const m = new Map(prev);
        const curr = m.get(shape_id) ?? [];
        m.set(shape_id, curr.filter(a => a.id !== id));
        return m;
      });
    });


    ch.subscribe();
    return () => {
      try { ch.unsubscribe(); } catch {}
      try { supabase.removeChannel(ch); } catch {}
      annotationsChRef.current = null;
    };
  }, []);

  const openModalForShape = useCallback(async (shapeId: string) => {
    setModalShapeId(shapeId);
    setAnnotationInput("");

    try {
      const { data, error } = await supabase
        .from("shape_annotations")
        .select("id,shape_id,user_id,text,created_at")
        .eq("shape_id", shapeId)
        .order("created_at", { ascending: true });

      if (!error && data) {
        const incoming = (data as Annotation[]).filter(a => a.text && a.text.trim().length > 0);

        setAnnotationsByShape(prev => {
          // merge existing + incoming by id (incoming wins on conflicts)
          const existing = prev.get(shapeId) ?? [];
          const byId = new Map<string, Annotation>();
          for (const a of existing) byId.set(a.id, a);
          for (const a of incoming) byId.set(a.id, a);

          const merged = Array.from(byId.values()).sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );

          const m = new Map(prev);
          m.set(shapeId, merged);
          return m;
        });
      }
      // If there’s an error, we keep existing optimistic/broadcast state—no overwrite.
    } catch (err) {
      console.warn("Annotation fetch skipped:", err);
    }
  }, []);

  const closeModal = useCallback(() => {
    setModalShapeId(null);
    setAnnotationInput("");
  }, []);

  // Handle ESC to close
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [closeModal]);

  // Right-click on a rect → open modal (without interfering with RMB drag)
  const onRectContextMenu = useCallback((e: React.MouseEvent<SVGRectElement>, id: string) => {
    e.preventDefault(); // block browser menu
    e.stopPropagation();
    openModalForShape(id);
  }, [openModalForShape]);

  const addAnnotation = useCallback(async () => {
    const text = annotationInput.trim();
    if (!text || !modalShapeId) return;
    const now = new Date().toISOString();
    const ann: Annotation = {
      id: (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `ann_${Math.random().toString(36).slice(2)}`,
      shape_id: modalShapeId,
      user_id: userId,
      text,
      created_at: now,
    };

    // optimistic add
    setAnnotationsByShape(prev => {
      const m = new Map(prev);
      const curr = m.get(modalShapeId) ?? [];
      m.set(modalShapeId, [...curr, ann]);
      return m;
    });
    setAnnotationInput("");

    // broadcast
    annotationsChRef.current?.send({ type: "broadcast", event: "annotation-upsert", payload: ann });

    // persist (best effort)
    const { error } = await supabase.from("shape_annotations").insert(ann as any);
    if (error) {
      console.warn("Annotation insert failed:", error.message);
      // keep optimistic state so multiuser via broadcast still shows it
    }
  }, [annotationInput, modalShapeId, userId]);

  const deleteAnnotation = useCallback(async (annotationId: string, shapeId: string) => {
    // Find the annotation we're deleting (for rollback if needed)
    const prev = annotationsByShape.get(shapeId) ?? [];
    const toRestore = prev.find(a => a.id === annotationId);
    if (!toRestore) return;

    // Only allow the author to delete (client-side guard; keep server-side RLS too)
    if (toRestore.user_id !== userId) return;

    // Optimistic remove
    setAnnotationsByShape(prevMap => {
      const m = new Map(prevMap);
      m.set(shapeId, (m.get(shapeId) ?? []).filter(a => a.id !== annotationId));
      return m;
    });

    // Broadcast to other clients
    annotationsChRef.current?.send({
      type: "broadcast",
      event: "annotation-delete",
      payload: { id: annotationId, shape_id: shapeId },
    });

    // Persist (best effort)
    const { error } = await supabase
      .from("shape_annotations")
      .delete()
      .eq("id", annotationId)
      .eq("user_id", userId); // enforce author-only deletes

    if (error) {
      console.warn("Annotation delete failed:", error.message);
      // Roll back
      setAnnotationsByShape(prevMap => {
        const m = new Map(prevMap);
        const arr = m.get(shapeId) ?? [];
        // Reinsert if it’s still missing
        if (!arr.some(a => a.id === toRestore.id)) {
          m.set(shapeId, [...arr, toRestore].sort(
            (a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          ));
        }
        return m;
      });
    }
  }, [annotationsByShape, userId]);


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
              onContextMenu={(e) => onRectContextMenu(e, s.id)}
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

      {/* Properties & Annotations Modal */}
      {modalShapeId && (() => {
        const s = shapesRef.current.get(modalShapeId);
        const email = profiles.get(userId) ?? userId;
        const anns = annotationsByShape.get(modalShapeId) ?? [];
        if (!s) return null;
        return (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center"
            aria-modal
            role="dialog"
          >
            {/* backdrop */}
            <div
              className="absolute inset-0 bg-black/40"
              onClick={closeModal}
            />
            {/* modal card */}
            <div className="relative z-10 w-[520px] max-w-[92vw] rounded-2xl bg-white p-5 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Rectangle Properties</h2>
                <button
                  className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
                  onClick={closeModal}
                  aria-label="Close properties"
                >
                  ✕
                </button>
              </div>

              {/* Properties */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">ID:</span> {s.id}</div>
                <div><span className="text-gray-500">Owner:</span> {s.created_by}</div>
                <div><span className="text-gray-500">X:</span> {s.x}</div>
                <div><span className="text-gray-500">Y:</span> {s.y}</div>
                <div><span className="text-gray-500">Width:</span> {s.width}</div>
                <div><span className="text-gray-500">Height:</span> {s.height}</div>
                <div><span className="text-gray-500">Stroke:</span> {s.stroke}</div>
                <div><span className="text-gray-500">Stroke width:</span> {s.stroke_width}</div>
                <div className="col-span-2"><span className="text-gray-500">Fill:</span> {s.fill ?? "none"}</div>
                {s.updated_at && <div className="col-span-2"><span className="text-gray-500">Updated:</span> {new Date(s.updated_at).toLocaleString()}</div>}
              </div>

              {/* Annotations */}
              <div className="mt-5">
                <h3 className="mb-2 text-sm font-medium">Annotations</h3>
                <div className="max-h-48 overflow-auto rounded border border-gray-200">
                  {anns.length === 0 ? (
                    <div className="p-3 text-sm text-gray-500">No annotations yet.</div>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {anns
                        .filter(a => a.text && a.text.trim().length > 0)
                        .map(a => {
                          const author = profiles.get(a.user_id) ?? a.user_id;
                          const isMine = a.user_id === userId;
                          return (
                            <li key={a.id} className="p-3 text-sm">
                              {/* Header row: author on the left, delete on the right */}
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <div className="font-medium">{author}</div>
                                {isMine && (
                                  <button
                                    className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded px-2 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                                    aria-label="Delete annotation"
                                    title="Delete annotation"
                                    onClick={() => deleteAnnotation(a.id, a.shape_id)}
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>

                              <div className="whitespace-pre-wrap">{a.text}</div>
                              <div className="mt-1 text-xs text-gray-400">
                                {new Date(a.created_at).toLocaleString()}
                              </div>
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </div>

                <div className="mt-3">
                  <label className="mb-1 block text-xs text-gray-600">Add annotation (as {email})</label>
                  <textarea
                    className="h-20 w-full rounded-md border border-gray-300 p-2 text-sm outline-none focus:border-blue-500"
                    placeholder="Type a note…"
                    value={annotationInput}
                    onChange={(e) => setAnnotationInput(e.target.value)}
                  />
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <button
                      className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                      onClick={closeModal}
                    >
                      Close
                    </button>
                    <button
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      onClick={addAnnotation}
                      disabled={!annotationInput.trim()}
                    >
                      Save annotation
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Debug HUD (optional) */}
      {showDebug && (
        <div className="absolute bottom-3 left-3 rounded bg-white/80 px-3 py-2 text-xs shadow">
          <div>scroll: ({Math.round(offset.x)}, {Math.round(offset.y)})</div>
          <div>zoom: {scale.toFixed(2)}×</div>
          <div>cursorΔ: ({Math.round(cursor.dx)}, {Math.round(cursor.dy)})</div>
          <div>sum: ({Math.round(offset.x + cursor.dx)}, {Math.round(offset.y + cursor.dy)})</div>
          <div className="opacity-60">
            Wheel pan • RMB pan • Ctrl/Cmd+Wheel zoom • LMB create/move • Dbl-click delete (sel=all) • Shift+Click select • Shift+Drag (bg) marquee • Cmd/Ctrl+C/X/V • RMB on rect → Properties • ? toggles HUD
          </div>
        </div>
      )}
     </div>
  );
}

