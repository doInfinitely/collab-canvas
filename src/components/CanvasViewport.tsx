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

  // geometry extensions
  sides?: number;       // 0 = ellipse, 3+ = regular polygon, default 4
  rotation?: number;    // radians, default 0
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

// ===== helpers for geometry =====
const resolveSides = (n?: number) => (n === 0 || (typeof n === "number" && n >= 3)) ? n : 4;

const deg = (rad: number) => (rad * 180) / Math.PI;

const polygonPoints = (x: number, y: number, w: number, h: number, n: number) => {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = Math.abs(w) / 2;
  const ry = Math.abs(h) / 2;
  const pts: string[] = [];
  const start = -Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const ang = start + (i * 2 * Math.PI) / n;
    const px = cx + rx * Math.cos(ang);
    const py = cy + ry * Math.sin(ang);
    pts.push(`${px},${py}`);
  }
  return pts.join(" ");
};

const nowIso = () => new Date().toISOString();

// ===== point helpers =====
const shapeCenter = (s: Shape) => ({ cx: s.x + s.width / 2, cy: s.y + s.height / 2 });

const worldToLocal = (s: Shape, wx: number, wy: number) => {
  const { cx, cy } = shapeCenter(s);
  const theta = s.rotation ?? 0;
  const dx = wx - cx;
  const dy = wy - cy;
  const c = Math.cos(-theta);
  const si = Math.sin(-theta);
  return { lx: dx * c - dy * si, ly: dx * si + dy * c };
};

// point-in-shape (true area), in world coords
const pointInShape = (s: Shape, wx: number, wy: number) => {
  const sides = resolveSides(s.sides);
  const { lx, ly } = worldToLocal(s, wx, wy);
  const rx = Math.abs(s.width) / 2;
  const ry = Math.abs(s.height) / 2;

  if (sides === 4) {
    return Math.abs(lx) <= rx && Math.abs(ly) <= ry;
  }
  if (sides === 0) {
    const v = (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry);
    return v <= 1;
  }
  // polygon: build local vertices, then wn/pnp
  const pts: Array<[number, number]> = [];
  const start = -Math.PI / 2;
  for (let i = 0; i < sides; i++) {
    const ang = start + (i * 2 * Math.PI) / sides;
    pts.push([rx * Math.cos(ang), ry * Math.sin(ang)]);
  }
  // ray-casting
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const intersect = yi > ly !== yj > ly && lx < ((xj - xi) * (ly - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

// distance to perimeter (approx), world coords → local frame, return "near" boolean with world tolerance
const nearPerimeter = (s: Shape, wx: number, wy: number, threshWorld: number) => {
  const sides = resolveSides(s.sides);
  const { lx, ly } = worldToLocal(s, wx, wy);
  const rx = Math.abs(s.width) / 2;
  const ry = Math.abs(s.height) / 2;

  if (sides === 4) {
    // distance to rect border
    const dx = Math.abs(Math.abs(lx) - rx);
    const dy = Math.abs(Math.abs(ly) - ry);
    // on edges where the other coord is within bounds
    const withinY = Math.abs(ly) <= ry + threshWorld;
    const withinX = Math.abs(lx) <= rx + threshWorld;
    const d =
      (withinY ? dx : Infinity) < (withinX ? dy : Infinity)
        ? dx
        : dy;
    // also ensure we are not far outside
    const outside =
      Math.abs(lx) > rx + threshWorld || Math.abs(ly) > ry + threshWorld;
    return !outside && d <= threshWorld;
  }

  if (sides === 0) {
    // ellipse: compare normalized radius to 1
    const rNorm = Math.sqrt((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry));
    // translate normalized band to world by min radius
    const minR = Math.min(rx, ry);
    const delta = Math.abs(rNorm - 1) * minR; // approx world distance to boundary
    return delta <= threshWorld;
  }

  // polygon: distance to segments
  const pts: Array<[number, number]> = [];
  const start = -Math.PI / 2;
  for (let i = 0; i < sides; i++) {
    const ang = start + (i * 2 * Math.PI) / sides;
    pts.push([rx * Math.cos(ang), ry * Math.sin(ang)]);
  }
  const distPointSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const abx = bx - ax, aby = by - ay;
    const apx = px - ax, apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (ab2 || 1)));
    const cx = ax + t * abx, cy = ay + t * aby;
    const dx = px - cx, dy = py - cy;
    return Math.hypot(dx, dy);
  };
  let dmin = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    dmin = Math.min(dmin, distPointSeg(lx, ly, a[0], a[1], b[0], b[1]));
  }
  return dmin <= threshWorld;
};

export default function CanvasViewport({ userId }: Props) {
  // ===== World offset (camera) & cursor displacement =====
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState({ dx: 0, dy: 0 });
  const [screenCursor, setScreenCursor] = useState({ x: 0, y: 0 });

  const [scale, setScale] = useState(1); // world→screen scale
  const scaleRef = useRef(scale);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  // --- Debug HUD toggle ---
  const [showDebug, setShowDebug] = useState(true);

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

  // Modal (properties + annotations)
  const [modalShapeId, setModalShapeId] = useState<string | null>(null);
  const [annotationInput, setAnnotationInput] = useState("");
  const [sidesInput, setSidesInput] = useState<string>("");

  // refs mirror latest values
  const offsetRef = useRef(offset);
  const cursorRef = useRef(cursor);
  const screenCursorRef = useRef(screenCursor);
  const selectedIdsRef = useRef(selectedIds);
  const shapesRef = useRef<Map<string, Shape>>(new Map());
  useEffect(() => { offsetRef.current = offset; }, [offset]);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => { screenCursorRef.current = screenCursor; }, [screenCursor]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

  const worldFromSvgEvent = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const sx = e.clientX - rect.left;  // svg-local screen x
    const sy = e.clientY - rect.top;   // svg-local screen y
    return {
      wx: offsetRef.current.x + sx / scaleRef.current,
      wy: offsetRef.current.y + sy / scaleRef.current,
    };
  }, []);

  const cursorForPerimeter = (s: Shape, wx: number, wy: number, modForRotate: boolean) => {
    if (modForRotate) return "grab" as const; // rotation hint everywhere on perimeter

    const sides = resolveSides(s.sides);
    if (sides === 4) {
      // Pick edge axis for a rectangle using local coords
      const { lx, ly } = worldToLocal(s, wx, wy);
      const rx = Math.abs(s.width) / 2;
      const ry = Math.abs(s.height) / 2;
      // distance to each edge (local, unsigned)
      const dx = Math.abs(Math.abs(lx) - rx);
      const dy = Math.abs(Math.abs(ly) - ry);
      // Closer axis defines cursor
      return (dx < dy) ? ("ew-resize" as const) : ("ns-resize" as const);
    }
    // For ellipse / polygons, crosshair is a good generic perimeter affordance
    return "crosshair" as const;
  };

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

  // SVG cursor (inherits into shapes)
  const [svgCursor, setSvgCursor] = useState<"default" | "crosshair" | "ew-resize" | "ns-resize" | "grab">("default");

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
        publish();
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

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const s = scaleRef.current;

    const spacing = GRID_SIZE * s;
    if (spacing < 4) return;

    const ox = ((-offsetRef.current.x * s) % spacing + spacing) % spacing;
    const oy = ((-offsetRef.current.y * s) % spacing + spacing) % spacing;

    ctx.fillStyle = DOT_COLOR;
    const r = Math.max(1, DOT_RADIUS * s * 0.9);
    for (let y = oy; y <= h; y += spacing) {
      for (let x = ox; x <= w; x += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, []);

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

  useEffect(() => { drawGrid(); }, [drawGrid, offset.x, offset.y]);

  // --- Panning (root) ---
  const panningRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });

  const onMouseDownRoot = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 2) return;
    panningRef.current = true;
    lastRef.current = { x: e.clientX, y: e.clientY };
  };

  const onMouseMoveRoot = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!panningRef.current) return;
    const dx = (e.clientX - lastRef.current.x) / scaleRef.current;
    const dy = (e.clientY - lastRef.current.y) / scaleRef.current;
    lastRef.current = { x: e.clientX, y: e.clientY };
    setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
    schedulePublish();
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const zoomIntensity = 0.0015;
      const old = scaleRef.current;
      const next = Math.min(4, Math.max(0.2, old * Math.exp(-e.deltaY * zoomIntensity)));
      const cx = e.clientX, cy = e.clientY;
      const worldX = offsetRef.current.x + cx / old;
      const worldY = offsetRef.current.y + cy / old;
      setScale(next);
      setOffset({ x: worldX - cx / next, y: worldY - cy / next });
    } else {
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

  // Live-sync channel
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

    // NEW: resize & rotate & sides
    ch.on("broadcast", { event: "shape-resize" }, ({ payload }: { payload: { id: string; x: number; y: number; width: number; height: number; updated_at?: string } }) => {
      setShapes(prev => {
        const m = new Map(prev);
        const s = m.get(payload.id);
        if (!s) return prev;
        m.set(payload.id, { ...s, x: payload.x, y: payload.y, width: payload.width, height: payload.height, updated_at: payload.updated_at ?? s.updated_at });
        return m;
      });
    });

    ch.on("broadcast", { event: "shape-rotate" }, ({ payload }: { payload: { id: string; rotation: number; updated_at?: string } }) => {
      setShapes(prev => {
        const m = new Map(prev);
        const s = m.get(payload.id);
        if (!s) return prev;
        m.set(payload.id, { ...s, rotation: payload.rotation, updated_at: payload.updated_at ?? s.updated_at });
        return m;
      });
    });

    ch.on("broadcast", { event: "shape-sides" }, ({ payload }: { payload: { ids: string[]; sides: number; updated_at?: string } }) => {
      setShapes(prev => {
        const m = new Map(prev);
        for (const id of payload.ids) {
          const s = m.get(id);
          if (!s) continue;
          m.set(id, { ...s, sides: resolveSides(payload.sides), updated_at: payload.updated_at ?? s.updated_at });
        }
        return m;
      });
    });

    ch.subscribe();

    return () => {
      try { ch.unsubscribe(); } catch {}
      try { supabase.removeChannel(ch); } catch {}
      shapesChRef.current = null;
    };
  }, [upsertShapeLocal, removeShapeLocal]);

  // Initial load
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

  // ===== Hit test helpers using real geometry =====
  const pickShape = useCallback((clientX: number, clientY: number): Shape | null => {
    const wx = offsetRef.current.x + clientX / scaleRef.current;
    const wy = offsetRef.current.y + clientY / scaleRef.current;
    const arr = Array.from(shapes.values());
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr[i];
      if (pointInShape(s, wx, wy)) return s;
    }
    return null;
  }, [shapes]);

  const pickShapeEvt = useCallback((e: React.MouseEvent<SVGSVGElement>): Shape | null => {
    const { wx, wy } = worldFromSvgEvent(e);
    const arr = Array.from(shapes.values());
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr[i];
      if (pointInShape(s, wx, wy)) return s;
    }
    return null;
  }, [shapes]);

  const pickPerimeter = useCallback((e: React.MouseEvent<SVGSVGElement>): Shape | null => {
    const { wx, wy } = worldFromSvgEvent(e);
    const threshWorld = 10 / scaleRef.current; // ~10px band
    const arr = Array.from(shapes.values());
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr[i];
      if (nearPerimeter(s, wx, wy, threshWorld)) return s;
    }
    return null;
  }, [shapes]);

  // ===== Drag state (create / move / resize / rotate) =====
  type DragState =
    | { kind: "none" }
    | { kind: "creating"; start: { x: number; y: number }; ghost: Shape }
    | { kind: "moving"; id: string; grabOffset: { dx: number; dy: number } }
    | {
        kind: "resizing";
        id: string;
        startWorld: { x: number; y: number };
        start: Shape;
        // NEW:
        lock: "x" | "y" | "uniform";
        startHalf: { rx: number; ry: number };
      }
    | { kind: "rotating"; id: string; startAngle: number; initialRot: number };

  const [drag, setDrag] = useState<DragState>({ kind: "none" });

  // Throttle DB updates while moving/resizing/rotating
  const moveRAF = useRef<number | null>(null);
  const scheduleMoveUpdate = (fn: () => void) => {
    if (moveRAF.current != null) return;
    moveRAF.current = requestAnimationFrame(() => {
      moveRAF.current = null;
      fn();
    });
  };

  // ===== Left-drag on SVG =====
  const onLeftDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;

    // 1) Check perimeter first (resize/rotate)
    const peri = pickPerimeter(e);
    if (peri) {
      const { wx, wy } = worldFromSvgEvent(e);
      if (e.metaKey || e.ctrlKey) {
        const { cx, cy } = shapeCenter(peri);
        const ang0 = Math.atan2(wy - cy, wx - cx);
        setDrag({ kind: "rotating", id: peri.id, startAngle: ang0, initialRot: peri.rotation ?? 0 });
        return
      }
      // --- RESIZE init ---
      const sides = resolveSides(peri.sides);
      const theta = peri.rotation ?? 0;
      const { cx, cy } = shapeCenter(peri);

      // world → local
      const dxw = wx - cx, dyw = wy - cy;
      const c = Math.cos(-theta), si = Math.sin(-theta);
      const lx = dxw * c - dyw * si;
      const ly = dxw * si + dyw * c;

      const rx0 = Math.abs(peri.width) / 2;
      const ry0 = Math.abs(peri.height) / 2;

      // Choose lock:
      // - Rect: axis closer to the edge (x vs y)
      // - Others: uniform (keep aspect)
      let lock: "x" | "y" | "uniform";
      if (sides === 4) {
        const dxEdge = Math.abs(Math.abs(lx) - rx0);
        const dyEdge = Math.abs(Math.abs(ly) - ry0);
        lock = dxEdge < dyEdge ? "x" : "y";
      } else {
        lock = "uniform";
      }

      setDrag({
        kind: "resizing",
        id: peri.id,
        startWorld: { x: wx, y: wy },
        start: { ...peri },
        lock,
        startHalf: { rx: rx0, ry: ry0 },
      });
      return; // IMPORTANT: don't fall through to create
    }

    // 2) Inside shape? move/selection
    const picked = pickShapeEvt(e);
    if (picked) {
      const { wx, wy } = worldFromSvgEvent(e);
      if (e.shiftKey) { addToSelection(picked.id); return; }

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

      const grabOffset = { dx: wx - picked.x, dy: wy - picked.y };
      setDrag({ kind: "moving", id: picked.id, grabOffset });
      return; // IMPORTANT
    }

    // 3) Background: marquee (shift) or create
    const { wx, wy } = worldFromSvgEvent(e);
    if (e.shiftKey) {
      setMarquee({ startX: wx, startY: wy, curX: wx, curY: wy });
      return;
    }

    clearSelection();
    const ghost: Shape = {
      id: "ghost",
      created_by: userId,
      x: wx,
      y: wy,
      width: 0,
      height: 0,
      stroke: "#000000",
      stroke_width: 2,
      fill: "#ffffff",
      sides: 4,
      rotation: 0,
    };
    setDrag({ kind: "creating", start: { x: wx, y: wy }, ghost });
  }, [userId, shapes, selectedIds, pickPerimeter, pickShapeEvt]);

  const onLeftMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const { wx, wy } = worldFromSvgEvent(e);

    // marquee update
    if (marquee) {
      setMarquee(m => (m ? { ...m, curX: wx, curY: wy } : m));
      return;
    }

    // multi-drag
    if (multiDragRef.current) {
      const dx = (e.clientX - multiDragRef.current.startMouseX) / scaleRef.current;
      const dy = (e.clientY - multiDragRef.current.startMouseY) / scaleRef.current;
      setShapes(prev => {
        const m = new Map(prev);
        for (const { id, x, y } of multiDragRef.current!.starts) {
          const s = m.get(id); if (!s) continue;
          m.set(id, { ...s, x: Math.round(x + dx), y: Math.round(y + dy), updated_at: nowIso() });
        }
        return m;
      });
      for (const { id, x, y } of multiDragRef.current.starts) {
        const nx = Math.round(x + dx), ny = Math.round(y + dy);
        shapesChRef.current?.send({ type: "broadcast", event: "shape-move", payload: { id, x: nx, y: ny, updated_at: nowIso() } });
        scheduleMoveUpdate(async () => { await supabase.from("shapes").update({ x: nx, y: ny, updated_at: nowIso() }).eq("id", id); });
      }
      return;
    }

    // creating
    if (drag.kind === "creating") {
      setDrag({
        kind: "creating",
        start: drag.start,
        ghost: { ...drag.ghost, width: wx - drag.start.x, height: wy - drag.start.y },
      });
      return;
    }

    // moving
    if (drag.kind === "moving") {
      const newX = wx - drag.grabOffset.dx;
      const newY = wy - drag.grabOffset.dy;
      setShapes(prev => {
        const m = new Map(prev);
        const s = m.get(drag.id); if (!s) return prev;
        m.set(drag.id, { ...s, x: Math.round(newX), y: Math.round(newY) });
        return m;
      });
      shapesChRef.current?.send({ type: "broadcast", event: "shape-move", payload: { id: drag.id, x: Math.round(newX), y: Math.round(newY), updated_at: nowIso() } });
      scheduleMoveUpdate(async () => {
        await supabase.from("shapes").update({ x: Math.round(newX), y: Math.round(newY), updated_at: nowIso() }).eq("id", drag.id);
      });
      return;
    }

    // resizing (axis-locked / uniform)
    if (drag.kind === "resizing") {
      const s0 = drag.start;
      const { cx, cy } = shapeCenter(s0);
      const theta = s0.rotation ?? 0;

      // world → local at current cursor
      const dxw = wx - cx, dyw = wy - cy;
      const c = Math.cos(-theta), si = Math.sin(-theta);
      const lx = dxw * c - dyw * si;
      const ly = dxw * si + dyw * c;

      const minHalf = 1.5;
      let rx = drag.startHalf.rx;
      let ry = drag.startHalf.ry;

      if (drag.lock === "x") {
        rx = Math.max(minHalf, Math.abs(lx));
      } else if (drag.lock === "y") {
        ry = Math.max(minHalf, Math.abs(ly));
      } else {
        const kx = Math.abs(lx) / (drag.startHalf.rx || 1);
        const ky = Math.abs(ly) / (drag.startHalf.ry || 1);
        const k = Math.max(kx, ky, minHalf / Math.max(drag.startHalf.rx, drag.startHalf.ry));
        rx = Math.max(minHalf, drag.startHalf.rx * k);
        ry = Math.max(minHalf, drag.startHalf.ry * k);
      }

      const newW = Math.round(rx * 2);
      const newH = Math.round(ry * 2);
      const nx = Math.round(cx - newW / 2);
      const ny = Math.round(cy - newH / 2);

      setShapes(prev => {
        const m = new Map(prev);
        const cur = m.get(drag.id); if (!cur) return prev;
        m.set(drag.id, { ...cur, x: nx, y: ny, width: newW, height: newH, updated_at: nowIso() });
        return m;
      });

      shapesChRef.current?.send({
        type: "broadcast",
        event: "shape-resize",
        payload: { id: drag.id, x: nx, y: ny, width: newW, height: newH, updated_at: nowIso() },
      });

      scheduleMoveUpdate(async () => {
        await supabase.from("shapes")
          .update({ x: nx, y: ny, width: newW, height: newH, updated_at: nowIso() })
          .eq("id", drag.id);
      });
      return;
    }

    // rotating
    if (drag.kind === "rotating") {
      const s0 = shapesRef.current.get(drag.id);
      if (!s0) return;
      const { cx, cy } = shapeCenter(s0);
      const ang = Math.atan2(wy - cy, wx - cx);
      const newRot = drag.initialRot + (ang - drag.startAngle);
      setShapes(prev => {
        const m = new Map(prev);
        const cur = m.get(drag.id); if (!cur) return prev;
        m.set(drag.id, { ...cur, rotation: newRot, updated_at: nowIso() });
        return m;
      });
      shapesChRef.current?.send({ type: "broadcast", event: "shape-rotate", payload: { id: drag.id, rotation: newRot, updated_at: nowIso() } });
      scheduleMoveUpdate(async () => {
        await supabase.from("shapes").update({ rotation: newRot, updated_at: nowIso() }).eq("id", drag.id);
      });
      return;
    }
  }, [drag, marquee]);

  const onLeftUp = useCallback(async () => {
    // finalize marquee
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

    // finish multi-drag (DB saves were scheduled during move)
    if (multiDragRef.current) { multiDragRef.current = null; return; }

    // creating finalize
    if (drag.kind === "creating") {
      const g = drag.ghost;
      const w = Math.round(g.width);
      const h = Math.round(g.height);
      const nx = Math.round(w >= 0 ? g.x : g.x + w);
      const ny = Math.round(h >= 0 ? g.y : g.y + h);
      const nw = Math.abs(w), nh = Math.abs(h);
      setDrag({ kind: "none" });
      if (nw >= 3 && nh >= 3) {
        const id = (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `shape_${Math.random().toString(36).slice(2)}`;
        const shape: Shape = {
          id, created_by: userId,
          x: nx, y: ny, width: nw, height: nh,
          stroke: "#000000", stroke_width: 2, fill: "#ffffff",
          updated_at: nowIso(),
          sides: 4, rotation: 0,
        };
        upsertShapeLocal(shape);
        shapesChRef.current?.send({ type: "broadcast", event: "shape-create", payload: shape });
        const { error } = await supabase.from("shapes").insert(shape);
        if (error) { console.warn("DB insert failed, rolling back local:", error); removeShapeLocal(id); }
      }
      return;
    }

    // moving / resizing / rotating end
    if (drag.kind === "moving" || drag.kind === "resizing" || drag.kind === "rotating") {
      setDrag({ kind: "none" });
    }
  }, [drag, marquee, shapes, userId, upsertShapeLocal, removeShapeLocal]);

  // ===== Double-click delete (delete all if any selected) =====
  const onDoubleClickSVG = useCallback(async (e: React.MouseEvent<SVGSVGElement>) => {
    if (drag.kind !== "none") return;
    const hit = pickShapeEvt(e); // uses worldFromSvgEvent under the hood
    if (!hit) return;
    const idsToDelete = selectedIds.has(hit.id) ? Array.from(selectedIds) : [hit.id];
    const toRestore = idsToDelete.map((id) => shapesRef.current.get(id)).filter(Boolean) as Shape[];
    setShapes(prev => { const m = new Map(prev); for (const id of idsToDelete) m.delete(id); return m; });
    for (const id of idsToDelete) shapesChRef.current?.send({ type: "broadcast", event: "shape-delete", payload: { id } });
    const { error } = await supabase.from("shapes").delete().in("id", idsToDelete);
    if (error) {
      console.warn("Batch delete failed:", error.message);
      setShapes(prev => { const m = new Map(prev); for (const s of toRestore) m.set(s.id, s); return m; });
    } else {
      setSelectedIds(new Set());
    }
  }, [drag, pickShape, selectedIds]);

  // ===== COPY / CUT / PASTE =====
  const worldCursor = () => ({
    x: offsetRef.current.x + screenCursorRef.current.x / scaleRef.current,
    y: offsetRef.current.y + screenCursorRef.current.y / scaleRef.current,
  });

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
    const shapesToCopy = ids.map((id) => shapesRef.current.get(id)).filter(Boolean) as Shape[];
    clipboardRef.current = shapesToCopy.map(s => ({ ...s }));
  }, []);

  const doCut = useCallback(async () => {
    const ids = Array.from(selectedIdsRef.current);
    if (ids.length === 0) return;
    const shapesToCut = ids.map((id) => shapesRef.current.get(id)).filter(Boolean) as Shape[];
    clipboardRef.current = shapesToCut.map(s => ({ ...s }));
    setShapes(prev => { const m = new Map(prev); for (const id of ids) m.delete(id); return m; });
    for (const id of ids) shapesChRef.current?.send({ type: "broadcast", event: "shape-delete", payload: { id } });
    const { error } = await supabase.from("shapes").delete().in("id", ids);
    if (error) {
      console.warn("Cut delete failed:", error.message);
      setShapes(prev => { const m = new Map(prev); for (const s of shapesToCut) m.set(s.id, s); return m; });
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
    const now = nowIso();
    const newShapes: Shape[] = clip.map((s) => ({
      ...s,
      id: (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `shape_${Math.random().toString(36).slice(2)}`,
      created_by: userId,
      x: Math.round(s.x + dx),
      y: Math.round(s.y + dy),
      updated_at: now,
    }));
    setShapes(prev => { const m = new Map(prev); for (const s of newShapes) m.set(s.id, s); return m; });
    for (const s of newShapes) shapesChRef.current?.send({ type: "broadcast", event: "shape-create", payload: s });
    const { error } = await supabase.from("shapes").insert(newShapes);
    if (error) {
      console.warn("Paste insert failed:", error.message);
      setShapes(prev => { const m = new Map(prev); for (const s of newShapes) m.delete(s.id); return m; });
      return;
    }
    setSelectedIds(new Set(newShapes.map((s) => s.id)));
  }, [userId]);

  // Global key handler (HUD toggle + copy/cut/paste)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault(); setShowDebug(v => !v); return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "c") { e.preventDefault(); doCopy(); }
      else if (k === "x") { e.preventDefault(); void doCut(); }
      else if (k === "v") { e.preventDefault(); void doPaste(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doCopy, doCut, doPaste]);

  // ===== Annotations (broadcast + DB) =====
  const [annotationsByShape, setAnnotationsByShape] = useState<Map<string, Annotation[]>>(new Map());
  const annotationsChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    const ch = supabase.channel("broadcast:annotations", { config: { broadcast: { self: false } } });
    annotationsChRef.current = ch;

    ch.on("broadcast", { event: "annotation-upsert" }, ({ payload }) => {
      const ann = payload as Annotation;
      if (!ann || !ann.shape_id || !ann.text) return;
      setAnnotationsByShape(prev => {
        const m = new Map(prev);
        const curr = m.get(ann.shape_id) ?? [];
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
    // init sides input from clicked shape
    const s = shapesRef.current.get(shapeId);
    setSidesInput(String(resolveSides(s?.sides)));

    try {
      const { data, error } = await supabase
        .from("shape_annotations")
        .select("id,shape_id,user_id,text,created_at")
        .eq("shape_id", shapeId)
        .order("created_at", { ascending: true });
      if (!error && data) {
        const incoming = (data as Annotation[]).filter(a => a.text && a.text.trim().length > 0);
        setAnnotationsByShape(prev => {
          const existing = prev.get(shapeId) ?? [];
          const byId = new Map<string, Annotation>();
          for (const a of existing) byId.set(a.id, a);
          for (const a of incoming) byId.set(a.id, a);
          const merged = Array.from(byId.values()).sort(
            (a,b)=> new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          const m = new Map(prev); m.set(shapeId, merged); return m;
        });
      }
    } catch (err) { console.warn("Annotation fetch skipped:", err); }
  }, []);

  const closeModal = useCallback(() => { setModalShapeId(null); setAnnotationInput(""); }, []);
  const addAnnotation = useCallback(async () => {
    const text = annotationInput.trim();
    if (!text || !modalShapeId) return;
    const now = nowIso();
    const ann: Annotation = {
      id: (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `ann_${Math.random().toString(36).slice(2)}`,
      shape_id: modalShapeId, user_id: userId, text, created_at: now,
    };
    setAnnotationsByShape(prev => { const m = new Map(prev); const curr = m.get(modalShapeId) ?? []; m.set(modalShapeId, [...curr, ann]); return m; });
    setAnnotationInput("");
    annotationsChRef.current?.send({ type: "broadcast", event: "annotation-upsert", payload: ann });
    const { error } = await supabase.from("shape_annotations").insert(ann as any);
    if (error) console.warn("Annotation insert failed:", error.message);
  }, [annotationInput, modalShapeId, userId]);

  const deleteAnnotation = useCallback(async (annotationId: string, shapeId: string) => {
    const prev = annotationsByShape.get(shapeId) ?? [];
    const toRestore = prev.find(a => a.id === annotationId);
    if (!toRestore) return;
    if (toRestore.user_id !== userId) return;

    setAnnotationsByShape(prevMap => { const m = new Map(prevMap); m.set(shapeId, (m.get(shapeId) ?? []).filter(a => a.id !== annotationId)); return m; });
    annotationsChRef.current?.send({ type: "broadcast", event: "annotation-delete", payload: { id: annotationId, shape_id: shapeId } });

    const { error } = await supabase.from("shape_annotations").delete().eq("id", annotationId).eq("user_id", userId);
    if (error) {
      console.warn("Annotation delete failed:", error.message);
      setAnnotationsByShape(prevMap => {
        const m = new Map(prevMap);
        const arr = m.get(shapeId) ?? [];
        if (!arr.some(a => a.id === toRestore.id)) {
          m.set(shapeId, [...arr, toRestore].sort((a,b)=> new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
        }
        return m;
      });
    }
  }, [annotationsByShape, userId]);

  const saveSides = useCallback(async () => {
    if (!modalShapeId) return;
    const parsed = Number(sidesInput.trim());
    if (!(parsed === 0 || parsed >= 3)) {
      const current = shapesRef.current.get(modalShapeId);
      setSidesInput(String(resolveSides(current?.sides)));
      return;
    }
    const ids = (selectedIds.size > 0 && selectedIds.has(modalShapeId))
      ? Array.from(selectedIds)
      : [modalShapeId];

    setShapes(prev => {
      const m = new Map(prev);
      const now = nowIso();
      for (const id of ids) {
        const s = m.get(id); if (!s) continue;
        m.set(id, { ...s, sides: parsed, updated_at: now });
      }
      return m;
    });

    shapesChRef.current?.send({ type: "broadcast", event: "shape-sides", payload: { ids, sides: parsed, updated_at: nowIso() } });

    try {
      const { error } = await supabase.from("shapes").update({ sides: parsed, updated_at: nowIso() }).in("id", ids);
      if (error) console.warn("Update sides failed:", error.message);
    } catch (err) { console.warn("Update sides exception:", err); }
  }, [modalShapeId, sidesInput, selectedIds]);
  
  const updateHoverCursor = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    // Don’t override cursor while actively dragging anything
    if (drag.kind !== "none") return;

    const { wx, wy } = worldFromSvgEvent(e);
    const threshWorld = 10 / scaleRef.current; // ~10px band
    const arr = Array.from(shapes.values());

    // Topmost-first
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr[i];
      if (nearPerimeter(s, wx, wy, threshWorld)) {
        setSvgCursor(cursorForPerimeter(s, wx, wy, e.metaKey || e.ctrlKey));
        return;
      }
    }
    setSvgCursor("default");
  }, [drag.kind, shapes]);

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

      {/* Shapes overlay (SVG) */}
      <svg
        className="absolute inset-0 w-full h-full"
        style={{ cursor: svgCursor }}               // NEW
        onMouseDown={onLeftDown}
        onMouseMove={(e) => {                       // UPDATED
          updateHoverCursor(e);
          onLeftMove(e);
        }}
        onMouseLeave={() => setSvgCursor("default")} // NEW
        onMouseUp={onLeftUp}
        onDoubleClick={onDoubleClickSVG}
      >
        <defs>
          <filter id="selGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#3b82f6" floodOpacity="0.9" />
          </filter>
        </defs>

        <g transform={`translate(${-offset.x * scale}, ${-offset.y * scale}) scale(${scale})`}>
          {shapeList.map((s) => {
            const sides = resolveSides(s.sides);
            const x = Math.min(s.x, s.x + s.width);
            const y = Math.min(s.y, s.y + s.height);
            const w = Math.abs(s.width);
            const h = Math.abs(s.height);
            const strokeW = s.stroke_width / scale;
            const rotDeg = deg(s.rotation ?? 0);
            const { cx, cy } = shapeCenter(s);

            if (sides === 4) {
              return (
                <rect
                  key={s.id}
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill={s.fill ?? "#ffffff"}
                  stroke={s.stroke}
                  strokeWidth={strokeW}
                  pointerEvents="all"
                  style={{ cursor: "inherit" }}
                  filter={selectedIds.has(s.id) ? "url(#selGlow)" : undefined}
                  transform={rotDeg ? `rotate(${rotDeg} ${cx} ${cy})` : undefined}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openModalForShape(s.id); }}
                />
              );
            }
            if (sides === 0) {
              return (
                <ellipse
                  key={s.id}
                  cx={x + w / 2}
                  cy={y + h / 2}
                  rx={w / 2}
                  ry={h / 2}
                  fill={s.fill ?? "#ffffff"}
                  stroke={s.stroke}
                  strokeWidth={strokeW}
                  pointerEvents="all"
                  style={{ cursor: "inherit" }}
                  filter={selectedIds.has(s.id) ? "url(#selGlow)" : undefined}
                  transform={rotDeg ? `rotate(${rotDeg} ${cx} ${cy})` : undefined}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openModalForShape(s.id); }}
                />
              );
            }
            return (
              <polygon
                key={s.id}
                points={polygonPoints(x, y, w, h, sides)}
                fill={s.fill ?? "#ffffff"}
                stroke={s.stroke}
                strokeWidth={strokeW}
                pointerEvents="all"
                style={{ cursor: "inherit" }}
                filter={selectedIds.has(s.id) ? "url(#selGlow)" : undefined}
                transform={rotDeg ? `rotate(${rotDeg} ${cx} ${cy})` : undefined}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openModalForShape(s.id); }}
              />
            );
          })}

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

        {/* Marquee overlay in screen coords */}
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

      {/* Multiplayer cursors */}
      <div className="absolute inset-0 pointer-events-none">
        {Array.from(remoteCursors.entries()).map(([uid, rc]) => {
          const sx = rc.worldX - offsetRef.current.x;
          const sy = rc.worldY - offsetRef.current.y;
          const email = profiles.get(uid) ?? uid.slice(0, 6);
          const color = colorFor(uid);
          return (
            <div key={uid} className="absolute" style={{ transform: `translate(${sx}px, ${sy}px)` }}>
              <svg width="14" height="20" viewBox="0 0 14 20" className="drop-shadow" style={{ display: "block" }}>
                <path d="M1 1 L13 9 L8 10 L9.5 18 L6.5 18 L5 10 L1 9 Z" fill={color} opacity={0.95}/>
                <path d="M1 1 L13 9 L8 10 L9.5 18 L6.5 18 L5 10 L1 9 Z" fill="none" stroke="black" strokeWidth="0.75"/>
              </svg>
              <div className="mt-[-2px] ml-[10px] rounded px-2 py-0.5 text-[11px] leading-[14px] text-white shadow" style={{ backgroundColor: color }}>
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
          <div className="absolute inset-0 z-50 flex items-center justify-center" aria-modal role="dialog">
            <div className="absolute inset-0 bg-black/40" onClick={closeModal} />
            <div className="relative z-10 w-[560px] max-w-[92vw] rounded-2xl bg-white p-5 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Shape Properties</h2>
                <button className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100" onClick={closeModal} aria-label="Close properties">✕</button>
              </div>

              {/* Properties */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">ID:</span> {s.id}</div>
                <div><span className="text-gray-500">Owner:</span> {s.created_by}</div>
                <div><span className="text-gray-500">X:</span> {s.x}</div>
                <div><span className="text-gray-500">Y:</span> {s.y}</div>
                <div><span className="text-gray-500">Width:</span> {s.width}</div>
                <div><span className="text-gray-500">Height:</span> {s.height}</div>
                <div><span className="text-gray-500">Rotation:</span> {Math.round(deg(s.rotation ?? 0))}°</div>
                <div><span className="text-gray-500">Stroke:</span> {s.stroke}</div>
                <div><span className="text-gray-500">Stroke width:</span> {s.stroke_width}</div>
                <div className="col-span-2"><span className="text-gray-500">Fill:</span> {s.fill ?? "none"}</div>
                {s.updated_at && <div className="col-span-2"><span className="text-gray-500">Updated:</span> {new Date(s.updated_at).toLocaleString()}</div>}
              </div>

              {/* Geometry */}
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-medium">Geometry</h3>
                <div className="flex items-end gap-3">
                  <div className="grow">
                    <label className="mb-1 block text-xs text-gray-600">Number of sides (0 = ellipse, 3+ = regular polygon)</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                      value={sidesInput}
                      onChange={(e) => setSidesInput(e.target.value)}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (!(v === 0 || v >= 3)) {
                          const current = shapesRef.current.get(modalShapeId!);
                          setSidesInput(String(resolveSides(current?.sides)));
                        }
                      }}
                    />
                    <p className="mt-1 text-xs text-gray-500">Defaults to 4 (rectangle). Invalid values (1 or 2) will revert.</p>
                  </div>
                  <button
                    className="h-9 shrink-0 rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    onClick={saveSides}
                    disabled={(() => { const v = Number(sidesInput); return !(v === 0 || v >= 3); })()}
                    title={(() => { const v = Number(sidesInput); return (v === 0 || v >= 3) ? "Apply to selected" : "Enter 0 or ≥3"; })()}
                  >Save</button>
                </div>
                {selectedIds.size > 0 && selectedIds.has(modalShapeId!) && (
                  <div className="mt-1 text-xs text-gray-500">
                    Will apply to {selectedIds.size} selected shape{selectedIds.size > 1 ? "s" : ""}.
                  </div>
                )}
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
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <div className="font-medium">{author}</div>
                                {isMine && (
                                  <button
                                    className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded px-2 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                                    aria-label="Delete annotation"
                                    title="Delete annotation"
                                    onClick={() => deleteAnnotation(a.id, a.shape_id)}
                                  >✕</button>
                                )}
                              </div>
                              <div className="whitespace-pre-wrap">{a.text}</div>
                              <div className="mt-1 text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</div>
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
                    <button className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100" onClick={closeModal}>Close</button>
                    <button className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" onClick={addAnnotation} disabled={!annotationInput.trim()}>Save annotation</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Debug HUD */}
      {showDebug && (
        <div className="absolute bottom-3 left-3 rounded bg-white/80 px-3 py-2 text-xs shadow">
          <div>scroll: ({Math.round(offset.x)}, {Math.round(offset.y)})</div>
          <div>zoom: {scale.toFixed(2)}×</div>
          <div>cursorΔ: ({Math.round(cursor.dx)}, {Math.round(cursor.dy)})</div>
          <div>sum: ({Math.round(offset.x + cursor.dx)}, {Math.round(offset.y + cursor.dy)})</div>
          <div className="opacity-60">
            Wheel pan • RMB pan • Ctrl/Cmd+Wheel zoom • LMB create/move • Perimeter drag = resize • Cmd/Ctrl+Perimeter drag = rotate • Dbl-click delete (sel=all) • Shift+Click select • Shift+Drag (bg) marquee • Cmd/Ctrl+C/X/V • RMB on shape → Properties • ? toggles HUD
          </div>
        </div>
      )}
    </div>
  );
}

