// src/components/CanvasViewport.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import Portal from "@/components/Portal";
import ChatBox from "@/components/ChatBox";

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

  sides?: number;
  rotation?: number;
  z?: number;

  name?: string; // NEW
  text_md?: string;
  text_color?: string; // NEW
};

type Annotation = {
  id: string;
  shape_id: string;
  user_id: string;
  text: string;
  created_at: string;
};

type ShapeAnnotationInsert = Pick<Annotation, "id" | "shape_id" | "user_id" | "text" | "created_at">;

type CanvasVersion = {
  id: string;
  created_at: string;
  created_by: string;
  snapshot: string; // JSON encoded canvas state
  preview?: string; // Optional thumbnail
};

// -------- Canvas config (grid) --------
const GRID_SIZE = 24;
const DOT_RADIUS = 1.5;
const DOT_COLOR = "#9ca3af";

function getTabId() {
  try { return crypto.randomUUID(); }
  catch { return `tab_${Math.random().toString(36).slice(2)}`; }
}

function colorFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h}, 75%, 45%)`;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const nowIso = () => new Date().toISOString();
const deg = (rad: number) => (rad * 180) / Math.PI;
const resolveSides = (n?: number) => (n === 0 || (typeof n === "number" && n >= 3)) ? n : 4;

// ===== Color helpers =====
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const HEX6 = /^#[0-9a-f]{6}$/i;

const normalizeHex = (hex: string) => {
  if (!HEX_RE.test(hex)) return null;
  const h = hex.toLowerCase();
  if (h.length === 4) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  return h;
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const n = normalizeHex(hex);
  if (!n) return null;
  const r = parseInt(n.slice(1, 3), 16);
  const g = parseInt(n.slice(3, 5), 16);
  const b = parseInt(n.slice(5, 7), 16);
  return { r, g, b };
};

const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

const rgbToHsv = (r: number, g: number, b: number) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
};

const hsvToRgb = (h: number, s: number, v: number) => {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (0 <= h && h < 60) { r = c; g = x; }
  else if (60 <= h && h < 120) { r = x; g = c; }
  else if (120 <= h && h < 180) { g = c; b = x; }
  else if (180 <= h && h < 240) { g = x; b = c; }
  else if (240 <= h && h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
};

function hsvToHex(h: number, s: number, v: number) {
  const { r, g, b } = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

// ===== geometry helpers =====
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

const pointInShape = (s: Shape, wx: number, wy: number) => {
  const sides = resolveSides(s.sides);
  const { lx, ly } = worldToLocal(s, wx, wy);
  const rx = Math.abs(s.width) / 2;
  const ry = Math.abs(s.height) / 2;

  if (sides === 4) return Math.abs(lx) <= rx && Math.abs(ly) <= ry;
  if (sides === 0) return (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1;

  const pts: Array<[number, number]> = [];
  const start = -Math.PI / 2;
  for (let i = 0; i < sides; i++) {
    const ang = start + (i * 2 * Math.PI) / sides;
    pts.push([rx * Math.cos(ang), ry * Math.sin(ang)]);
  }
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const intersect = yi > ly !== yj > ly && lx < ((xj - xi) * (ly - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

const nearPerimeter = (s: Shape, wx: number, wy: number, threshWorld: number) => {
  const sides = resolveSides(s.sides);
  const { lx, ly } = worldToLocal(s, wx, wy);
  const rx = Math.abs(s.width) / 2;
  const ry = Math.abs(s.height) / 2;

  if (sides === 4) {
    const dx = Math.abs(Math.abs(lx) - rx);
    const dy = Math.abs(Math.abs(ly) - ry);
    const withinY = Math.abs(ly) <= ry + threshWorld;
    const withinX = Math.abs(lx) <= rx + threshWorld;
    const d = (withinY ? dx : Infinity) < (withinX ? dy : Infinity) ? dx : dy;
    const outside = Math.abs(lx) > rx + threshWorld || Math.abs(ly) > ry + threshWorld;
    return !outside && d <= threshWorld;
  }

  if (sides === 0) {
    const rNorm = Math.sqrt((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry));
    const minR = Math.min(rx, ry);
    const delta = Math.abs(rNorm - 1) * minR;
    return delta <= threshWorld;
  }

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

const renderMarkdown = (text: string) => {
  if (!text) return "";
  let html = text;
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  html = html.replace(/`(.+?)`/g, '<code style="background:#f3f4f6;padding:2px 4px;border-radius:3px;font-family:monospace;font-size:0.9em">$1</code>');
  html = html.replace(/\n/g, '<br>');
  return html;
};

// Replace the simple getTextBoxBounds with this comprehensive version
const getTextBoxBounds = (s: Shape) => {
  const sides = resolveSides(s.sides);
  const { cx, cy } = shapeCenter(s);
  const theta = s.rotation ?? 0;
  const rx = Math.abs(s.width) / 2;
  const ry = Math.abs(s.height) / 2;

  // For unrotated shapes, use the simple calculation
  if (Math.abs(theta) < 0.001) {
    const factor = 0.7;
    return { boxW: rx * 2 * factor, boxH: ry * 2 * factor };
  }

  // For rotated shapes, we need to find the largest axis-aligned rectangle
  // that fits inside the rotated shape

  // Get the shape's boundary points in world coordinates
  const getBoundaryPoints = (): Array<[number, number]> => {
    const points: Array<[number, number]> = [];
    const numPoints = sides === 0 ? 64 : sides; // Use 64 points for ellipse approximation
    const startAngle = -Math.PI / 2;

    for (let i = 0; i < numPoints; i++) {
      const angle = startAngle + (i * 2 * Math.PI) / numPoints;
      // Local coordinates
      const lx = rx * Math.cos(angle);
      const ly = ry * Math.sin(angle);
      
      // Rotate to world coordinates
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const wx = cx + (lx * c - ly * s);
      const wy = cy + (lx * s + ly * c);
      
      points.push([wx, wy]);
    }
    return points;
  };

  const boundaryPoints = getBoundaryPoints();

  // Find the axis-aligned bounding box of all boundary points
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const [x, y] of boundaryPoints) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  // Check if a point is inside the shape (in world coordinates)
  const isInsideShape = (wx: number, wy: number): boolean => {
    // Transform to local coordinates
    const dx = wx - cx;
    const dy = wy - cy;
    const c = Math.cos(-theta);
    const si = Math.sin(-theta);
    const lx = dx * c - dy * si;
    const ly = dx * si + dy * c;

    if (sides === 4) {
      return Math.abs(lx) <= rx && Math.abs(ly) <= ry;
    }
    if (sides === 0) {
      return (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1;
    }

    // Polygon: use ray casting
    const pts: Array<[number, number]> = [];
    const start = -Math.PI / 2;
    for (let i = 0; i < sides; i++) {
      const ang = start + (i * 2 * Math.PI) / sides;
      pts.push([rx * Math.cos(ang), ry * Math.sin(ang)]);
    }
    
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      const intersect = yi > ly !== yj > ly && lx < ((xj - xi) * (ly - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  // Binary search to find the largest rectangle centered at cx, cy
  // that fits inside the shape
  const findMaxRectangle = (): { boxW: number; boxH: number } => {
    const maxW = maxX - minX;
    const maxH = maxY - minY;

    // Binary search for width
    let wLow = 0, wHigh = maxW;
    for (let iter = 0; iter < 20; iter++) {
      const testW = (wLow + wHigh) / 2;
      const testH = maxH * (testW / maxW); // Maintain aspect ratio loosely
      
      // Check if rectangle with this width fits
      const corners = [
        [cx - testW / 2, cy - testH / 2],
        [cx + testW / 2, cy - testH / 2],
        [cx - testW / 2, cy + testH / 2],
        [cx + testW / 2, cy + testH / 2],
      ];
      
      const allInside = corners.every(([x, y]) => isInsideShape(x, y));
      
      if (allInside) {
        wLow = testW;
      } else {
        wHigh = testW;
      }
    }

    // Binary search for height with the found width
    const finalW = wLow * 0.95; // Use 95% of max for safety margin
    let hLow = 0, hHigh = maxH;
    for (let iter = 0; iter < 20; iter++) {
      const testH = (hLow + hHigh) / 2;
      
      const corners = [
        [cx - finalW / 2, cy - testH / 2],
        [cx + finalW / 2, cy - testH / 2],
        [cx - finalW / 2, cy + testH / 2],
        [cx + finalW / 2, cy + testH / 2],
      ];
      
      const allInside = corners.every(([x, y]) => isInsideShape(x, y));
      
      if (allInside) {
        hLow = testH;
      } else {
        hHigh = testH;
      }
    }

    const finalH = hLow * 0.95; // Use 95% of max for safety margin
    
    return { boxW: Math.max(20, finalW), boxH: Math.max(20, finalH) };
  };

  return findMaxRectangle();
};

const pointInTextBox = (s: Shape, wx: number, wy: number) => {
  const { cx, cy } = shapeCenter(s);
  const { boxW, boxH } = getTextBoxBounds(s);
  const dx = Math.abs(wx - cx);
  const dy = Math.abs(wy - cy);
  return dx <= boxW / 2 && dy <= boxH / 2;
};

export default function CanvasViewport({ userId }: Props) {
  // ===== camera & cursors =====
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState({ dx: 0, dy: 0 });
  const [screenCursor, setScreenCursor] = useState({ x: 0, y: 0 });

  const [scale, setScale] = useState(1);
  const scaleRef = useRef(scale);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  const [showDebug, setShowDebug] = useState(true);

  // selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const clearSelection = () => setSelectedIds(new Set());
  const addToSelection = (id: string) =>
    setSelectedIds((prev) => (prev.has(id) ? prev : new Set([...prev, id])));

  const multiDragRef = useRef<null | {
    startMouseX: number;
    startMouseY: number;
    starts: Array<{ id: string; x: number; y: number }>;
  }>(null);

  const [marquee, setMarquee] = useState<null | {
    startX: number; startY: number; curX: number; curY: number;
  }>(null);

  const clipboardRef = useRef<Shape[] | null>(null);
  const dblClickRef = useRef(false);

  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const textDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const clickStartRef = useRef<{ x: number; y: number; shapeId: string | null } | null>(null);

  // Modal state
  const [modalShapeId, setModalShapeId] = useState<string | null>(null);
  const [annotationInput, setAnnotationInput] = useState("");
  const [sidesInput, setSidesInput] = useState<string>("");

  // Z-index input state
  const [zIndexInput, setZIndexInput] = useState<string>("");

  // Keep the input in sync when the modal opens / the shape changes
  useEffect(() => {
    if (!modalShapeId) return;
    const s = shapesRef.current.get(modalShapeId);
    setZIndexInput(s ? String(s.z ?? 0) : "0");
  }, [modalShapeId]);

  // Style inputs
  const [strokeWidthInput, setStrokeWidthInput] = useState<string>("");
  const [strokeColorInput, setStrokeColorInput] = useState<string>("");
  const [fillColorInput, setFillColorInput] = useState<string>("");
  const [noFill, setNoFill] = useState<boolean>(false);
  const [textColorInput, setTextColorInput] = useState<string>(""); // NEW

  // Color picker popover
  const [picker, setPicker] = useState<null | {
    for: "stroke" | "fill" | "text"; // UPDATED
    x: number;
    y: number;
    initial?: string;
  }>(null);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [lastColorTarget, setLastColorTarget] = useState<"stroke" | "fill" | "text">("stroke"); // UPDATED

  // refs
  const offsetRef = useRef(offset);
  const cursorRef = useRef(cursor);
  const screenCursorRef = useRef(screenCursor);
  const selectedIdsRef = useRef(selectedIds);
  const shapesRef = useRef<Map<string, Shape>>(new Map());
  useEffect(() => { offsetRef.current = offset; }, [offset]);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => { screenCursorRef.current = screenCursor; }, [screenCursor]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  

  // load/save recent colors
  useEffect(() => {
    try {
      const raw = localStorage.getItem("recentColors");
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) setRecentColors(arr.filter(c => HEX_RE.test(c)));
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("recentColors", JSON.stringify(recentColors.slice(0, 16))); } catch {}
  }, [recentColors]);

  const addRecentColor = (hex: string) => {
    const n = normalizeHex(hex);
    if (!n) return;
    setRecentColors((prev) => {
      const filtered = prev.filter((c) => c.toLowerCase() !== n);
      return [n, ...filtered].slice(0, 16);
    });
  };

  const worldFromSvgEvent = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return {
      wx: offsetRef.current.x + sx / scaleRef.current,
      wy: offsetRef.current.y + sy / scaleRef.current,
    };
  }, []);

  const [wordlists, setWordlists] = useState<{ adjs: string[]; nouns: string[] } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [aRes, nRes] = await Promise.all([
        fetch("/names/adjectives.txt"),
        fetch("/names/nouns.txt"),
      ]);
      const [aText, nText] = await Promise.all([aRes.text(), nRes.text()]);
      if (!alive) return;
      const adjs = aText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const nouns = nText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      setWordlists({ adjs, nouns });
    })();
    return () => { alive = false; };
  }, []);

  // helper: TitleCase and concat
  const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
  const toName = (adj: string, noun: string) => `${cap(adj)}${cap(noun)}`;

  const usedNames = () => {
    const set = new Set<string>();
    for (const s of shapesRef.current.values()) {
      if (s.name) set.add(s.name.toLowerCase());
    }
    return set;
  };

  function randomName(adjs: string[], nouns: string[]): string {
    const taken = usedNames();
    // simple LCG-based deterministic-ish from timestamp to reduce repetition across tabs
    let seed = Date.now() ^ Math.floor(Math.random() * 0x9e3779b1);
    const lcg = () => (seed = (seed * 1664525 + 1013904223) >>> 0);

    const maxTries = 5000;
    for (let i = 0; i < maxTries; i++) {
      const ai = lcg() % adjs.length;
      const ni = lcg() % nouns.length;
      const name = toName(adjs[ai], nouns[ni]);
      if (!taken.has(name.toLowerCase())) return name;
    }
    // Worst case: append a number
    const base = toName(adjs[lcg() % adjs.length], nouns[lcg() % nouns.length]);
    let k = 2;
    while (taken.has(`${base}${k}`.toLowerCase())) k++;
    return `${base}${k}`;
  }
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ===== presence =====
  const tabIdRef = useRef(getTabId());
  const presenceChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const rafRef = useRef<number | null>(null);

  const [profiles, setProfiles] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("id,email");
      if (data) setProfiles(new Map(data.map((r) => [r.id as string, (r.email as string) ?? ""])));
    })();
  }, []);

  const [svgCursor, setSvgCursor] = useState<"default" | "crosshair" | "ew-resize" | "ns-resize" | "nwse-resize" | "nesw-resize" | "grab">("default");

  type RemoteCursor = { worldX: number; worldY: number; at: number };
  const [remoteCursors, setRemoteCursors] = useState<Map<string, RemoteCursor>>(new Map());

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

  function isBackgroundRightClick(e: React.MouseEvent) {
    const svg = (e.currentTarget as HTMLElement).querySelector('svg') as SVGSVGElement | null;
    if (!svg) return true;
    const rect = svg.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wx = offsetRef.current.x + sx / scaleRef.current;
    const wy = offsetRef.current.y + sy / scaleRef.current;
    return !findTopShapeAt(wx, wy);
  }

  // Return the topmost shape at world coords (or null if background)
  function findTopShapeAt(wx: number, wy: number): Shape | null {
    // Use same z/order you use to draw: z asc (back to front), last wins
    const ordered = Array.from(shapesRef.current.values()).sort((a, b) => {
      const za = a.z ?? 0, zb = b.z ?? 0;
      if (za !== zb) return za - zb;
      const ta = new Date(a.updated_at ?? 0).getTime();
      const tb = new Date(b.updated_at ?? 0).getTime();
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });
    // iterate from frontmost to backmost
    for (let i = ordered.length - 1; i >= 0; i--) {
      const s = ordered[i];
      if (pointInShape(s, wx, wy) || pointInTextBox(s, wx, wy)) return s;
    }
    return null;
  }

  // Encode canvas to JSON
  const encodeCanvasToJSON = useCallback(() => {
    const canvasState = {
      shapes: Array.from(shapesRef.current.values()).map(s => ({
        id: s.id,
        created_by: s.created_by,
        x: s.x,
        y: s.y,
        width: s.width,
        height: s.height,
        stroke: s.stroke,
        stroke_width: s.stroke_width,
        fill: s.fill,
        sides: s.sides,
        rotation: s.rotation,
        z: s.z,
        name: s.name,
        text_md: s.text_md,
        text_color: s.text_color,
        updated_at: s.updated_at,
      })),
      metadata: {
        version: 1,
        exported_at: nowIso(),
        exported_by: userId,
      }
    };
    return JSON.stringify(canvasState, null, 2);
  }, [userId]);

  // Decode and load canvas from JSON
  const loadCanvasFromJSON = useCallback(async (jsonStr: string) => {
    try {
      const canvasState = JSON.parse(jsonStr);
      if (!canvasState.shapes || !Array.isArray(canvasState.shapes)) {
        throw new Error("Invalid canvas JSON format");
      }

      // Clear existing shapes
      const oldShapes = Array.from(shapesRef.current.values());
      setShapes(new Map());

      // Delete from DB
      const oldIds = oldShapes.map(s => s.id);
      if (oldIds.length > 0) {
        await supabase.from("shapes").delete().in("id", oldIds);
        for (const id of oldIds) {
          shapesChRef.current?.send({ type: "broadcast", event: "shape-delete", payload: { id } });
        }
      }

      // Insert new shapes
      const newShapes = canvasState.shapes as Shape[];
      setShapes(new Map(newShapes.map(s => [s.id, s])));
      
      // Broadcast and persist
      for (const shape of newShapes) {
        shapesChRef.current?.send({ type: "broadcast", event: "shape-create", payload: shape });
      }
      
      const { error } = await supabase.from("shapes").insert(newShapes);
      if (error) {
        console.warn("Failed to restore shapes to DB:", error);
      }

      return true;
    } catch (err) {
      console.error("Failed to load canvas from JSON:", err);
      return false;
    }
  }, [userId]);

  // Tiny XML escaper for names
  function escapeXML(s: string) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const buildExportSVG = (): string | null => {
    const svg = svgRef.current;
    if (!svg) return null;

    // Get current viewport dimensions
    const rect = svg.getBoundingClientRect();
    const viewportWidth = rect.width || 1200;
    const viewportHeight = rect.height || 800;

    // Calculate visible world coordinates
    const worldLeft = offsetRef.current.x;
    const worldTop = offsetRef.current.y;
    const worldWidth = viewportWidth / scaleRef.current;
    const worldHeight = viewportHeight / scaleRef.current;

    // Create standalone SVG with viewBox matching visible area
    const viewBox = `${worldLeft} ${worldTop} ${worldWidth} ${worldHeight}`;

    // Build shape elements directly
    const shapeElements = shapeOrdered.map(s => {
      const sides = resolveSides(s.sides);
      const x = Math.min(s.x, s.x + s.width);
      const y = Math.min(s.y, s.y + s.height);
      const w = Math.abs(s.width);
      const h = Math.abs(s.height);
      const rotDeg = deg(s.rotation ?? 0);
      const { cx, cy } = shapeCenter(s);

      const transform = rotDeg ? ` transform="rotate(${rotDeg} ${cx} ${cy})"` : '';
      const fill = s.fill ?? 'transparent';
      const stroke = s.stroke;
      const strokeWidth = s.stroke_width;

      let shapeEl = '';
      if (sides === 4) {
        shapeEl = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${transform}/>`;
      } else if (sides === 0) {
        shapeEl = `<ellipse cx="${x + w/2}" cy="${y + h/2}" rx="${w/2}" ry="${h/2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${transform}/>`;
      } else {
        shapeEl = `<polygon points="${polygonPoints(x, y, w, h, sides)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${transform}/>`;
      }

      // Add text_md if present - positioned exactly as on screen using foreignObject
      let textEl = '';
      if (s.text_md && s.text_md.trim()) {
        const { boxW, boxH } = getTextBoxBounds(s);
        const textColor = (s.text_color && HEX_RE.test(s.text_color)) ? s.text_color : '#000000';
        const fontSize = 14;
        
        // Render markdown to HTML (same as on-screen)
        const htmlContent = renderMarkdown(s.text_md);
        
        // Use foreignObject to embed HTML exactly as shown on screen
        const transformFO = rotDeg ? ` transform="rotate(${rotDeg} ${cx} ${cy})"` : "";

        textEl = `<foreignObject x="${cx - boxW/2}" y="${cy - boxH/2}" width="${boxW}" height="${boxH}"${transformFO}>
          <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;padding:8px;overflow:auto;font-size:${fontSize}px;color:${textColor};font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica Neue,Arial;">
            ${htmlContent}
          </div>
        </foreignObject>`;
      }

      return shapeEl + textEl;
    }).join('\n');

    // Create dot grid pattern
    const dotPattern = `
      <pattern id="dotGrid" width="${GRID_SIZE}" height="${GRID_SIZE}" patternUnits="userSpaceOnUse">
        <circle cx="0" cy="0" r="${DOT_RADIUS}" fill="${DOT_COLOR}" />
      </pattern>
    `;

    const exportSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${viewportWidth}" height="${viewportHeight}">
      <defs>${dotPattern}</defs>
      <rect x="${worldLeft}" y="${worldTop}" width="${worldWidth}" height="${worldHeight}" fill="url(#dotGrid)"/>
      ${shapeElements}
    </svg>`;

    return exportSVG;
  };

  const exportAsSVG = useCallback(() => {
    const svgString = buildExportSVG();
    if (!svgString) return;
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `canvas-${Date.now()}.svg`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const exportAsPNG = useCallback(() => {
    const svgString = buildExportSVG();
    if (!svgString) return;

    const live = svgRef.current;
    // Size from actual on-screen bounding box; fallback to viewBox
    let width = 0, height = 0;
    if (live) {
      const rect = live.getBoundingClientRect();
      width = Math.round(rect.width);
      height = Math.round(rect.height);
      if ((!width || !height) && live.viewBox.baseVal?.width && live.viewBox.baseVal?.height) {
        width = live.viewBox.baseVal.width;
        height = live.viewBox.baseVal.height;
      }
    }
    if (!width || !height) { width = 1200; height = 800; }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Some browsers behave better with data-URL than blob-URL for SVG rasterization
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
    const img = new Image();

    img.onload = async () => {
      try { await img.decode?.(); } catch {}
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((png) => {
        if (!png) return;
        const a = document.createElement('a');
        a.download = `canvas-${Date.now()}.png`;
        a.href = URL.createObjectURL(png);
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    };
    img.onerror = () => {
      // Fallback: try blob URL if data URL failed for any reason
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img2 = new Image();
      img2.onload = () => {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img2, 0, 0, width, height);
        URL.revokeObjectURL(url);
        canvas.toBlob((png) => {
          if (!png) return;
          const a = document.createElement('a');
          a.download = `canvas-${Date.now()}.png`;
          a.href = URL.createObjectURL(png);
          a.click();
          URL.revokeObjectURL(a.href);
        }, 'image/png');
      };
      img2.onerror = () => URL.revokeObjectURL(url);
      img2.src = url;
    };

    img.src = dataUrl;
  }, []);

  // Export canvas as JSON
  const exportAsJSON = useCallback(() => {
    const json = encodeCanvasToJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.download = `canvas-${Date.now()}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }, [encodeCanvasToJSON]);

  // Save current canvas as a version
  const saveCanvasVersion = useCallback(async () => {
    const snapshot = encodeCanvasToJSON();
    const version: Omit<CanvasVersion, 'id'> = {
      created_at: nowIso(),
      created_by: userId,
      snapshot,
    };

    const { data, error } = await supabase
      .from('canvas_versions')
      .insert(version)
      .select()
      .single();

    if (error) {
      console.error("Failed to save version:", error);
      return false;
    }

    // Reload versions
    loadCanvasVersions();
    return true;
  }, [encodeCanvasToJSON, userId]);

  // Load all versions
  const loadCanvasVersions = useCallback(async () => {
    const { data, error } = await supabase
      .from('canvas_versions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error("Failed to load versions:", error);
      return;
    }

    setCanvasVersions((data as CanvasVersion[]) || []);
  }, []);

  const [canvasMenuPos, setCanvasMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [canvasVersions, setCanvasVersions] = useState<CanvasVersion[]>([]);
  const [showCanvasMenu, setShowCanvasMenu] = useState(false);
  const [canvasMenuTab, setCanvasMenuTab] = useState<'export' | 'versions'>('export');

  // use to force a re-render when we only mutate refs
  const [, forceRender] = useState(0);

  // Restore a version
  const restoreCanvasVersion = useCallback(async (versionId: string) => {
    const version = canvasVersions.find(v => v.id === versionId);
    if (!version) return false;

    const success = await loadCanvasFromJSON(version.snapshot);
    if (success) {
      setShowCanvasMenu(false);
    }
    return success;
  }, [canvasVersions, loadCanvasFromJSON]);

  useEffect(() => {
    loadCanvasVersions();
  }, [loadCanvasVersions]);
  
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
  const containerRef = useRef<HTMLDivElement | null>(null);

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
  const panStartRef = useRef({ x: 0, y: 0 }); // Track start position
  const panDidMoveRef = useRef(false); // Track if panning actually moved
  const panCommittedRef = useRef(false); // Track if we've committed to panning
  const panTimerRef = useRef<number | null>(null); // Timer for delay

  const onMouseDownRoot = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 2) return;
    panningRef.current = true;
    panDidMoveRef.current = false;
    panCommittedRef.current = false;
    panStartRef.current = { x: e.clientX, y: e.clientY };
    lastRef.current = { x: e.clientX, y: e.clientY };
    
    // Set a timer - if still holding after 250ms, commit to panning
    panTimerRef.current = window.setTimeout(() => {
      if (panningRef.current) {
        panCommittedRef.current = true;
        // Close modal if open
        setShowCanvasMenu(false);
      }
    }, 250);
  };

  const PAN_THRESHOLD = 5; // pixels in screen space

  const onMouseMoveRoot = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!panningRef.current) return;
    const s = scaleRef.current;
    const dxScr = e.clientX - lastRef.current.x;
    const dyScr = e.clientY - lastRef.current.y;

    // Check total distance from start
    const totalDx = e.clientX - panStartRef.current.x;
    const totalDy = e.clientY - panStartRef.current.y;
    const totalDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

    // If we've moved beyond threshold, commit to panning
    if (!panCommittedRef.current && totalDist >= PAN_THRESHOLD) {
      panCommittedRef.current = true;
      panDidMoveRef.current = true;
      // Close modal if open
      setShowCanvasMenu(false);
    }

    // Only actually pan if we've committed
    if (panCommittedRef.current) {
      panDidMoveRef.current = true;
      lastRef.current = { x: e.clientX, y: e.clientY };
      setOffset(o => ({ x: o.x + dxScr / s, y: o.y + dyScr / s }));
      schedulePublish();
    }
  };

  const onWheel = (e: WheelEvent) => {
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

  // Attach wheel event listener with passive: false to allow preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, []);

  // ===== AI Pan to Coordinate =====
  const panToCoordinate = useCallback((targetX: number, targetY: number) => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const viewportCenterX = rect.width / 2;
    const viewportCenterY = rect.height / 2;

    // Current center in world coordinates
    const currentCenterX = offsetRef.current.x + viewportCenterX / scaleRef.current;
    const currentCenterY = offsetRef.current.y + viewportCenterY / scaleRef.current;

    // Calculate distance
    const dx = targetX - currentCenterX;
    const dy = targetY - currentCenterY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Target offset to center on the coordinate
    const targetOffsetX = targetX - viewportCenterX / scaleRef.current;
    const targetOffsetY = targetY - viewportCenterY / scaleRef.current;

    // If distance is large (> 2000px), instant jump
    if (distance > 2000) {
      setOffset({ x: targetOffsetX, y: targetOffsetY });
      schedulePublish();
      return;
    }

    // Otherwise, smooth animation
    const startOffset = { ...offsetRef.current };
    const startTime = Date.now();
    const duration = 600; // 600ms animation

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease out cubic
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      const currentX = startOffset.x + (targetOffsetX - startOffset.x) * easeProgress;
      const currentY = startOffset.y + (targetOffsetY - startOffset.y) * easeProgress;

      setOffset({ x: currentX, y: currentY });

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        schedulePublish();
      }
    };

    requestAnimationFrame(animate);
  }, [schedulePublish]);

  // ===== AI Helper Functions =====
  const getSelectedShapeIds = useCallback(() => {
    return Array.from(selectedIds);
  }, [selectedIds]);

  const getUserCursors = useCallback(() => {
    return Array.from(remoteCursors.entries()).map(([uid, cursor]) => ({
      userId: uid,
      email: profiles.get(uid) ?? uid,
      worldX: cursor.worldX,
      worldY: cursor.worldY,
    }));
  }, [remoteCursors, profiles]);

  // AI: Get UI state (modals, HUD, versions)
  const getUIState = useCallback(() => {
    return {
      shapeModalOpen: modalShapeId !== null,
      shapeModalShapeId: modalShapeId,
      debugHUDVisible: showDebug,
      canvasMenuOpen: showCanvasMenu,
      canvasMenuTab: canvasMenuTab,
      availableVersions: canvasVersions.map(v => ({
        id: v.id,
        created_at: v.created_at,
        created_by: v.created_by,
        email: profiles.get(v.created_by) ?? v.created_by,
      })),
    };
  }, [modalShapeId, showDebug, showCanvasMenu, canvasMenuTab, canvasVersions, profiles]);

  // AI: Update shape properties
  const aiUpdateShapeProperties = useCallback(async (shapeId: string, updates: Partial<Shape>) => {
    console.log('AI: Updating shape', shapeId, 'with updates:', updates);
    
    const shape = shapesRef.current.get(shapeId);
    if (!shape) {
      console.error('AI: Shape not found:', shapeId);
      return { success: false, error: 'Shape not found' };
    }

    // Round numeric values to avoid database integer errors
    const roundedUpdates = { ...updates };
    if (roundedUpdates.x !== undefined) roundedUpdates.x = Math.round(roundedUpdates.x);
    if (roundedUpdates.y !== undefined) roundedUpdates.y = Math.round(roundedUpdates.y);
    if (roundedUpdates.width !== undefined) roundedUpdates.width = Math.round(roundedUpdates.width);
    if (roundedUpdates.height !== undefined) roundedUpdates.height = Math.round(roundedUpdates.height);

    const now = nowIso();
    const updatedShape = { ...shape, ...roundedUpdates, updated_at: now };
    
    console.log('AI: Updated shape will be:', updatedShape);
    
    // Update local state
    setShapes(prev => {
      const m = new Map(prev);
      m.set(shapeId, updatedShape);
      return m;
    });

    // Broadcast
    if (shapesChRef.current) {
      shapesChRef.current.send({ 
        type: "broadcast", 
        event: "shape-create", 
        payload: updatedShape 
      });
      console.log('AI: Broadcasted shape update');
    } else {
      console.warn('AI: shapesChRef is null, cannot broadcast');
    }

    // Update DB
    const { error } = await supabase
      .from("shapes")
      .update(roundedUpdates)
      .eq("id", shapeId);

    if (error) {
      console.error("AI: Shape update DB error:", error);
      // Rollback
      setShapes(prev => {
        const m = new Map(prev);
        m.set(shapeId, shape);
        return m;
      });
      return { success: false, error: error.message };
    }

    console.log('AI: Shape updated successfully');
    return { success: true };
  }, []);

  // AI: Rename shape with validation
  const aiRenameShape = useCallback(async (shapeId: string, newName: string) => {
    if (!wordlists) {
      return { success: false, error: 'Wordlists not loaded' };
    }

    // Parse AdjectiveNoun format
    const match = newName.match(/^([A-Z][a-z]+)([A-Z][a-z]+)$/);
    if (!match) {
      return { success: false, error: 'Name must be in AdjectiveNoun format (e.g., BigCircle)' };
    }

    const [, adj, noun] = match;
    
    // Validate against wordlists
    const adjLower = adj.toLowerCase();
    const nounLower = noun.toLowerCase();
    
    if (!wordlists.adjs.map(a => a.toLowerCase()).includes(adjLower)) {
      return { success: false, error: `"${adj}" is not in the adjective list` };
    }
    if (!wordlists.nouns.map(n => n.toLowerCase()).includes(nounLower)) {
      return { success: false, error: `"${noun}" is not in the noun list` };
    }

    // Check if name is already taken
    const taken = usedNames();
    if (taken.has(newName.toLowerCase())) {
      return { success: false, error: `Name "${newName}" is already taken` };
    }

    return await aiUpdateShapeProperties(shapeId, { name: newName });
  }, [wordlists, aiUpdateShapeProperties]);

  // AI: Add annotation to shape
  const aiAddAnnotation = useCallback(async (shapeId: string, text: string) => {
    const shape = shapesRef.current.get(shapeId);
    if (!shape) {
      return { success: false, error: 'Shape not found' };
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      return { success: false, error: 'Annotation text cannot be empty' };
    }

    const ann: ShapeAnnotationInsert = {
      id: crypto.randomUUID(),
      shape_id: shapeId,
      user_id: userId,
      text: trimmedText,
      created_at: nowIso(),
    };

    // Optimistic update
    setAnnotationsByShape(prev => {
      const m = new Map(prev);
      const arr = m.get(shapeId) ?? [];
      m.set(shapeId, [...arr, ann]);
      return m;
    });

    // Broadcast
    annotationsChRef.current?.send({
      type: "broadcast",
      event: "annotation-upsert",
      payload: ann,
    });

    // DB insert
    const { error } = await supabase.from("shape_annotations").insert(ann);
    if (error) {
      console.warn("Annotation insert failed:", error.message);
      // Rollback
      setAnnotationsByShape(prev => {
        const m = new Map(prev);
        const arr = (m.get(shapeId) ?? []).filter(a => a.id !== ann.id);
        m.set(shapeId, arr);
        return m;
      });
      return { success: false, error: error.message };
    }

    return { success: true };
  }, [userId]);

  // AI: Add annotations to multiple shapes
  const aiAddAnnotations = useCallback(async (annotations: Array<{ shapeId: string; text: string }>) => {
    const validAnnotations = annotations.filter(({ shapeId }) => shapesRef.current.has(shapeId));
    if (validAnnotations.length === 0) {
      return { success: false, error: 'No valid shapes found' };
    }

    const createdAnnotations: Annotation[] = [];
    const annotationsToRollback: Array<{ shapeId: string; id: string }> = [];

    // Create all annotations
    for (const { shapeId, text } of validAnnotations) {
      const ann: Annotation = {
        id: crypto.randomUUID(),
        shape_id: shapeId,
        user_id: userId,
        text,
        created_at: nowIso(),
      };
      createdAnnotations.push(ann);
      annotationsToRollback.push({ shapeId, id: ann.id });

      // Update local state
      setAnnotationsByShape(prev => {
        const m = new Map(prev);
        const arr = m.get(shapeId) ?? [];
        m.set(shapeId, [...arr, ann]);
        return m;
      });
    }

    // Batch insert to DB
    const { error } = await supabase.from("shape_annotations").insert(createdAnnotations);
    if (error) {
      console.warn("Batch annotation insert failed:", error.message);
      // Rollback all
      for (const { shapeId, id } of annotationsToRollback) {
        setAnnotationsByShape(prev => {
          const m = new Map(prev);
          const arr = (m.get(shapeId) ?? []).filter(a => a.id !== id);
          m.set(shapeId, arr);
          return m;
        });
      }
      return { success: false, error: error.message };
    }

    return { success: true, count: createdAnnotations.length };
  }, [userId]);

  // AI: Update properties for multiple shapes
  const aiUpdateShapesProperties = useCallback(async (shapeIds: string[], updates: Partial<Shape>) => {
    const validIds = shapeIds.filter(id => shapesRef.current.has(id));
    if (validIds.length === 0) {
      return { success: false, error: 'No valid shapes found' };
    }

    // Round numeric values to avoid database integer errors
    const roundedUpdates = { ...updates };
    if (roundedUpdates.x !== undefined) roundedUpdates.x = Math.round(roundedUpdates.x);
    if (roundedUpdates.y !== undefined) roundedUpdates.y = Math.round(roundedUpdates.y);
    if (roundedUpdates.width !== undefined) roundedUpdates.width = Math.round(roundedUpdates.width);
    if (roundedUpdates.height !== undefined) roundedUpdates.height = Math.round(roundedUpdates.height);

    const now = nowIso();
    const shapesToRestore: Shape[] = [];

    // Update local state for all shapes
    setShapes(prev => {
      const m = new Map(prev);
      for (const id of validIds) {
        const shape = m.get(id);
        if (shape) {
          shapesToRestore.push(shape);
          const updatedShape = { ...shape, ...roundedUpdates, updated_at: now };
          m.set(id, updatedShape);

          // Broadcast
          shapesChRef.current?.send({ 
            type: "broadcast", 
            event: "shape-create", 
            payload: updatedShape 
          });
        }
      }
      return m;
    });

    // Batch update DB
    const { error } = await supabase
      .from("shapes")
      .update(roundedUpdates)
      .in("id", validIds);

    if (error) {
      console.error("Batch shape update DB error:", error);
      // Rollback all
      setShapes(prev => {
        const m = new Map(prev);
        for (const shape of shapesToRestore) {
          m.set(shape.id, shape);
        }
        return m;
      });
      return { success: false, error: error.message };
    }

    return { success: true, count: validIds.length };
  }, []);

  // AI: Update properties for current selection
  const aiUpdateSelectionProperties = useCallback(async (updates: Partial<Shape>) => {
    const selectedIdsArray = Array.from(selectedIds);
    if (selectedIdsArray.length === 0) {
      return { success: false, error: 'No shapes selected' };
    }

    // Round numeric values to avoid database integer errors
    const roundedUpdates = { ...updates };
    if (roundedUpdates.x !== undefined) roundedUpdates.x = Math.round(roundedUpdates.x);
    if (roundedUpdates.y !== undefined) roundedUpdates.y = Math.round(roundedUpdates.y);
    if (roundedUpdates.width !== undefined) roundedUpdates.width = Math.round(roundedUpdates.width);
    if (roundedUpdates.height !== undefined) roundedUpdates.height = Math.round(roundedUpdates.height);

    const now = nowIso();
    const shapesToRestore: Shape[] = [];

    // Update local state for all selected shapes
    setShapes(prev => {
      const m = new Map(prev);
      for (const id of selectedIdsArray) {
        const shape = m.get(id);
        if (shape) {
          shapesToRestore.push(shape);
          const updatedShape = { ...shape, ...roundedUpdates, updated_at: now };
          m.set(id, updatedShape);

          // Broadcast
          shapesChRef.current?.send({ 
            type: "broadcast", 
            event: "shape-create", 
            payload: updatedShape 
          });
        }
      }
      return m;
    });

    // Batch update DB
    const { error } = await supabase
      .from("shapes")
      .update(roundedUpdates)
      .in("id", selectedIdsArray);

    if (error) {
      console.error("Selection update DB error:", error);
      // Rollback all
      setShapes(prev => {
        const m = new Map(prev);
        for (const shape of shapesToRestore) {
          m.set(shape.id, shape);
        }
        return m;
      });
      return { success: false, error: error.message };
    }

    return { success: true, count: selectedIdsArray.length };
  }, [selectedIds]);

  // Helper functions for z-index
  const frontZ = () => {
    const values = Array.from(shapesRef.current.values());
    const maxZ = values.length ? Math.max(...values.map(s => s.z ?? 0)) : 0;
    return Math.floor(maxZ) + 1;
  };
  const backZ = () => {
    const values = Array.from(shapesRef.current.values());
    const minZ = values.length ? Math.min(...values.map(s => s.z ?? 0)) : 0;
    return Math.ceil(minZ) - 1;
  };

  // Helper functions for shape manipulation
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

  // AI: Add shapes to selection
  const aiAddToSelection = useCallback((shapeIds: string[]) => {
    const validIds = shapeIds.filter(id => shapesRef.current.has(id));
    if (validIds.length === 0) {
      return { success: false, error: 'No valid shapes found' };
    }

    setSelectedIds(prev => {
      const newSet = new Set(prev);
      validIds.forEach(id => newSet.add(id));
      return newSet;
    });

    return { success: true, added: validIds.length };
  }, []);

  // AI: Remove shapes from selection
  const aiRemoveFromSelection = useCallback((shapeIds: string[]) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      shapeIds.forEach(id => newSet.delete(id));
      return newSet;
    });

    return { success: true, removed: shapeIds.length };
  }, []);

  // AI: Clear selection
  const aiClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    return { success: true };
  }, []);

  // AI: Create shape
  const aiCreateShape = useCallback(async (params: {
    x: number;
    y: number;
    width: number;
    height: number;
    sides?: number;
    stroke?: string;
    fill?: string | null;
    text_md?: string;
    text_color?: string;
  }) => {
    if (!wordlists) {
      return { success: false, error: 'Wordlists not loaded' };
    }

    const id = crypto.randomUUID();
    const name = randomName(wordlists.adjs, wordlists.nouns);
    const shape: Shape = {
      id,
      created_by: userId,
      x: Math.round(params.x),
      y: Math.round(params.y),
      width: Math.round(params.width),
      height: Math.round(params.height),
      stroke: params.stroke || "#000000",
      stroke_width: 2,
      fill: params.fill !== undefined ? params.fill : "#ffffff",
      sides: params.sides !== undefined ? params.sides : 4,
      rotation: 0,
      z: frontZ(),
      name,
      text_md: params.text_md,
      text_color: params.text_color || "#000000",
      updated_at: nowIso(),
    };

    upsertShapeLocal(shape);
    shapesChRef.current?.send({ type: "broadcast", event: "shape-create", payload: shape });
    
    const { error } = await supabase.from("shapes").insert(shape);
    if (error) {
      console.warn("AI: Shape creation failed:", error);
      removeShapeLocal(id);
      return { success: false, error: error.message };
    }

    return { success: true, shapeId: id, shapeName: name };
  }, [wordlists, userId, frontZ, upsertShapeLocal, removeShapeLocal]);

  // AI: Create multiple shapes in batch
  const aiCreateShapes = useCallback(async (shapesList: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    sides?: number;
    stroke?: string;
    fill?: string | null;
    text_md?: string;
    text_color?: string;
  }>) => {
    if (!wordlists) {
      return { success: false, error: 'Wordlists not loaded' };
    }

    const createdShapes: Shape[] = [];
    const usedNames = new Set<string>();

    // Generate all shapes
    for (const params of shapesList) {
      let name = randomName(wordlists.adjs, wordlists.nouns);
      // Ensure unique names
      while (usedNames.has(name)) {
        name = randomName(wordlists.adjs, wordlists.nouns);
      }
      usedNames.add(name);

      const shape: Shape = {
        id: crypto.randomUUID(),
        created_by: userId,
        x: Math.round(params.x),
        y: Math.round(params.y),
        width: Math.round(params.width),
        height: Math.round(params.height),
        stroke: params.stroke || "#000000",
        stroke_width: 2,
        fill: params.fill !== undefined ? params.fill : "#ffffff",
        sides: params.sides !== undefined ? params.sides : 4,
        rotation: 0,
        z: frontZ(),
        name,
        text_md: params.text_md,
        text_color: params.text_color || "#000000",
        updated_at: nowIso(),
      };
      createdShapes.push(shape);
    }

    // Update local state
    for (const shape of createdShapes) {
      upsertShapeLocal(shape);
      shapesChRef.current?.send({ type: "broadcast", event: "shape-create", payload: shape });
    }

    // Batch insert to DB
    const { error } = await supabase.from("shapes").insert(createdShapes);
    if (error) {
      console.warn("AI: Batch shape creation failed:", error);
      // Rollback
      for (const shape of createdShapes) {
        removeShapeLocal(shape.id);
      }
      return { success: false, error: error.message };
    }

    return { 
      success: true, 
      count: createdShapes.length,
      shapeIds: createdShapes.map(s => s.id),
      shapeNames: createdShapes.map(s => s.name),
    };
  }, [wordlists, userId, frontZ, upsertShapeLocal, removeShapeLocal]);

  // AI: Delete shapes
  const aiDeleteShapes = useCallback(async (shapeIds: string[]) => {
    const validIds = shapeIds.filter(id => shapesRef.current.has(id));
    if (validIds.length === 0) {
      return { success: false, error: 'No valid shapes found' };
    }

    const toRestore = validIds.map(id => shapesRef.current.get(id)).filter(Boolean) as Shape[];
    
    // Optimistic delete
    setShapes(prev => {
      const m = new Map(prev);
      validIds.forEach(id => m.delete(id));
      return m;
    });

    // Broadcast
    for (const id of validIds) {
      shapesChRef.current?.send({ type: "broadcast", event: "shape-delete", payload: { id } });
    }

    // DB delete
    const { error } = await supabase.from("shapes").delete().in("id", validIds);
    if (error) {
      console.warn("AI: Delete failed:", error);
      // Rollback
      setShapes(prev => {
        const m = new Map(prev);
        toRestore.forEach(s => m.set(s.id, s));
        return m;
      });
      return { success: false, error: error.message };
    }

    // Clear selection if deleted shapes were selected
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      validIds.forEach(id => newSet.delete(id));
      return newSet;
    });

    return { success: true, deletedCount: validIds.length };
  }, []);

  // AI: Open/close/toggle shape property modal
  const aiToggleShapeModal = useCallback((action: 'open' | 'close' | 'toggle', shapeId?: string) => {
    if (action === 'close') {
      setModalShapeId(null);
      return { success: true, isOpen: false };
    }
    
    if (action === 'toggle') {
      if (modalShapeId) {
        setModalShapeId(null);
        return { success: true, isOpen: false };
      } else if (shapeId && shapesRef.current.has(shapeId)) {
        setModalShapeId(shapeId);
        return { success: true, isOpen: true, shapeId };
      } else {
        return { success: false, error: 'No shape specified for toggle' };
      }
    }
    
    if (action === 'open') {
      if (!shapeId) {
        return { success: false, error: 'Shape ID required to open modal' };
      }
      if (!shapesRef.current.has(shapeId)) {
        return { success: false, error: 'Shape not found' };
      }
      setModalShapeId(shapeId);
      return { success: true, isOpen: true, shapeId };
    }

    return { success: false, error: 'Invalid action' };
  }, [modalShapeId]);

  // AI: Toggle debug HUD
  const aiToggleDebugHUD = useCallback((action: 'show' | 'hide' | 'toggle') => {
    if (action === 'show') {
      setShowDebug(true);
      return { success: true, isVisible: true };
    } else if (action === 'hide') {
      setShowDebug(false);
      return { success: true, isVisible: false };
    } else {
      setShowDebug(prev => !prev);
      return { success: true, isVisible: !showDebug };
    }
  }, [showDebug]);

  // AI: Toggle canvas menu
  const aiToggleCanvasMenu = useCallback((action: 'show' | 'hide' | 'toggle', tab?: 'export' | 'versions') => {
    if (action === 'show') {
      setShowCanvasMenu(true);
      if (tab) setCanvasMenuTab(tab);
      return { success: true, isOpen: true };
    } else if (action === 'hide') {
      setShowCanvasMenu(false);
      return { success: true, isOpen: false };
    } else {
      setShowCanvasMenu(prev => !prev);
      if (tab) setCanvasMenuTab(tab);
      return { success: true, isOpen: !showCanvasMenu };
    }
  }, [showCanvasMenu]);

  // AI: Download PNG
  const aiDownloadPNG = useCallback(() => {
    exportAsPNG();
    return { success: true };
  }, [exportAsPNG]);

  // AI: Download SVG
  const aiDownloadSVG = useCallback(() => {
    exportAsSVG();
    return { success: true };
  }, [exportAsSVG]);

  // AI: Download JSON
  const aiDownloadJSON = useCallback(() => {
    exportAsJSON();
    return { success: true };
  }, [exportAsJSON]);

  // AI: Save version
  const aiSaveVersion = useCallback(async () => {
    const result = await saveCanvasVersion();
    return { success: result !== false };
  }, [saveCanvasVersion]);

  // AI: Restore version
  const aiRestoreVersion = useCallback(async (identifier: string | number) => {
    // Handle different identifier types
    let versionToRestore: CanvasVersion | undefined;

    if (typeof identifier === 'string') {
      // Try to match by date/time string or version ID
      versionToRestore = canvasVersions.find(v => 
        v.id === identifier || 
        v.created_at.includes(identifier) ||
        new Date(v.created_at).toLocaleString().includes(identifier)
      );
    } else if (typeof identifier === 'number') {
      // Handle "last version", "5 versions ago", etc.
      const index = identifier;
      if (index >= 0 && index < canvasVersions.length) {
        versionToRestore = canvasVersions[index];
      }
    }

    if (!versionToRestore) {
      return { success: false, error: 'Version not found' };
    }

    const result = await restoreCanvasVersion(versionToRestore.id);
    return { success: result, versionId: versionToRestore.id };
  }, [canvasVersions, restoreCanvasVersion]);

  // AI: Set zoom level (optionally with pan to focus point)
  const aiSetZoom = useCallback((zoomLevel: number, focusX?: number, focusY?: number) => {
    // Clamp zoom level to reasonable bounds (10% to 500%)
    const clampedZoom = Math.max(0.1, Math.min(5.0, zoomLevel));
    
    // If focus point provided, adjust offset to keep that point centered
    if (focusX !== undefined && focusY !== undefined) {
      const svg = svgRef.current;
      if (svg) {
        const rect = svg.getBoundingClientRect();
        const viewportCenterX = rect.width / 2;
        const viewportCenterY = rect.height / 2;
        
        // Calculate new offset to keep focus point at viewport center
        const newOffsetX = focusX - viewportCenterX / clampedZoom;
        const newOffsetY = focusY - viewportCenterY / clampedZoom;
        
        setOffset({ x: newOffsetX, y: newOffsetY });
      }
    }
    
    setScale(clampedZoom);
    schedulePublish(); // Broadcast zoom and pan change to other users
    return { success: true, zoom: clampedZoom, focusX, focusY };
  }, [schedulePublish]);

  // AI: Get current pan/scroll position
  const aiGetViewport = useCallback(() => {
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    const centerX = offset.x + (rect?.width ?? 0) / 2 / scale;
    const centerY = offset.y + (rect?.height ?? 0) / 2 / scale;
    
    return {
      offsetX: offset.x,
      offsetY: offset.y,
      centerX,
      centerY,
      zoom: scale,
      viewportWidth: rect?.width ?? 0,
      viewportHeight: rect?.height ?? 0,
    };
  }, [offset, scale]);

  // AI: Set pan position (scroll)
  const aiSetPan = useCallback((x: number, y: number) => {
    setOffset({ x, y });
    schedulePublish();
    return { success: true, offsetX: x, offsetY: y };
  }, [schedulePublish]);

  const onMouseUpRoot = (e: React.MouseEvent<HTMLDivElement>) => { 
    // Handle right mouse button up
    if (e.button === 2) {
      // Clear the timer if it's still running
      if (panTimerRef.current !== null) {
        clearTimeout(panTimerRef.current);
        panTimerRef.current = null;
      }

      // Only show canvas menu if we didn't commit to panning or move
      if (!panCommittedRef.current && !panDidMoveRef.current && isBackgroundRightClick(e)) {
        setCanvasMenuPos({ x: e.clientX, y: e.clientY });
        setCanvasMenuTab('export');   // default tab
        setShowCanvasMenu(true);
      }

      // Reset pan flags
      panningRef.current = false;
      panDidMoveRef.current = false;
      panCommittedRef.current = false;
    } else {
      panningRef.current = false;
    }
  };  
  
  const onContextMenuRoot = (e: React.MouseEvent<HTMLDivElement>) => {
    // Always prevent the browser's context menu
    e.preventDefault();
  };

  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onGlobalPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        // Click happened *inside* the menu — don't close.
        return;
      }
      // Otherwise, close on any outside left-click
      if (e.button === 0) setShowCanvasMenu(false);
    };

    // Use capture so we run before React stops propagation elsewhere.
    window.addEventListener("pointerdown", onGlobalPointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", onGlobalPointerDown, { capture: true });
  }, []);

  // ===== Shapes =====
  const [shapes, setShapes] = useState<Map<string, Shape>>(new Map());
  const shapeList = useMemo(() => Array.from(shapes.values()), [shapes]);
  useEffect(() => { shapesRef.current = shapes; }, [shapes]);

  // draw order: z asc, then updated_at asc, then id asc
  const shapeOrderCmp = (a: Shape, b: Shape) => {
    const za = a.z ?? 0, zb = b.z ?? 0;
    if (za !== zb) return za - zb;
    const ta = new Date(a.updated_at ?? 0).getTime();
    const tb = new Date(b.updated_at ?? 0).getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  };
  const shapeOrdered = useMemo(() => {
    const arr = Array.from(shapes.values());
    arr.sort(shapeOrderCmp);
    return arr;
  }, [shapes]);

  // Live-sync
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

    ch.on("broadcast", { event: "shape-z" }, ({ payload }: { payload: { ids: string[]; z: number; updated_at?: string } }) => {
      setShapes(prev => {
        const m = new Map(prev);
        for (const id of payload.ids) {
          const s = m.get(id);
          if (!s) continue;
          m.set(id, { ...s, z: payload.z, updated_at: payload.updated_at ?? s.updated_at });
        }
        return m;
      });
    });

    // NEW: style (stroke, fill, stroke_width)
    ch.on("broadcast", { event: "shape-style" }, ({ payload }: { payload: { ids: string[]; stroke?: string; fill?: string | null; stroke_width?: number; updated_at?: string } }) => {
      setShapes(prev => {
        const m = new Map(prev);
        for (const id of payload.ids) {
          const s = m.get(id);
          if (!s) continue;
          m.set(id, {
            ...s,
            stroke: payload.stroke ?? s.stroke,
            fill: (payload.fill === undefined ? s.fill : payload.fill),
            stroke_width: payload.stroke_width ?? s.stroke_width,
            updated_at: payload.updated_at ?? s.updated_at
          });
        }
        return m;
      });
    });

    ch.on("broadcast", { event: "shape-name" }, ({ payload }: { payload: { id: string; name: string; updated_at?: string } }) => {
      setShapes(prev => {
        const m = new Map(prev);
        const s = m.get(payload.id);
        if (!s) return prev;
        m.set(payload.id, { ...s, name: payload.name, updated_at: payload.updated_at ?? s.updated_at });
        return m;
      });
    });

    ch.on("broadcast", { event: "shape-text" }, ({ payload }: { payload: { id: string; text_md: string; updated_at?: string } }) => {
      setShapes(prev => {
        const m = new Map(prev);
        const s = m.get(payload.id);
        if (!s) return prev;
        m.set(payload.id, { ...s, text_md: payload.text_md, updated_at: payload.updated_at ?? s.updated_at });
        return m;
      });
    });

    ch.on("broadcast", { event: "shape-style" }, ({ payload }: { payload: { ids: string[]; stroke?: string; fill?: string | null; stroke_width?: number; text_color?: string; updated_at?: string } }) => {
      setShapes(prev => {
        const m = new Map(prev);
        for (const id of payload.ids) {
          const s = m.get(id);
          if (!s) continue;
          m.set(id, {
            ...s,
            stroke: payload.stroke ?? s.stroke,
            fill: (payload.fill === undefined ? s.fill : payload.fill),
            stroke_width: payload.stroke_width ?? s.stroke_width,
            text_color: payload.text_color ?? s.text_color, // NEW
            updated_at: payload.updated_at ?? s.updated_at
          });
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

  // After the existing initial shapes fetch (or in a subsequent effect)
  useEffect(() => {
    if (!wordlists) return;
    // find nameless shapes
    const nameless = Array.from(shapesRef.current.values()).filter(s => !s.name);
    if (nameless.length === 0) return;

    const updates: Array<{ id: string; name: string }> = [];
    for (const s of nameless) {
      const name = randomName(wordlists.adjs, wordlists.nouns);
      updates.push({ id: s.id, name });
    }

    if (updates.length === 0) return;

    // optimistic local update
    setShapes(prev => {
      const m = new Map(prev);
      const now = nowIso();
      for (const u of updates) {
        const cur = m.get(u.id); if (!cur) continue;
        m.set(u.id, { ...cur, name: u.name, updated_at: now });
      }
      return m;
    });

    // broadcast each
    for (const u of updates) {
      shapesChRef.current?.send({ type: "broadcast", event: "shape-name", payload: { id: u.id, name: u.name, updated_at: nowIso() } });
    }

    // persist (batched update)
    (async () => {
      try {
        // If your Supabase allows upsert-like update by array, great.
        // Otherwise loop; keeping simple & robust:
        for (const u of updates) {
          await supabase.from("shapes").update({ name: u.name, updated_at: nowIso() }).eq("id", u.id);
        }
      } catch (e) {
        console.warn("Backfill names failed:", e);
      }
    })();
  }, [wordlists]);

  // ===== Hit test (z-aware) =====
  const pickShapeEvt = useCallback((e: React.MouseEvent<SVGSVGElement>): Shape | null => {
    const { wx, wy } = worldFromSvgEvent(e);
    for (let i = shapeOrdered.length - 1; i >= 0; i--) {
      const s = shapeOrdered[i];
      if (pointInShape(s, wx, wy)) return s;
    }
    return null;
  }, [shapeOrdered, worldFromSvgEvent]);

  const pickPerimeter = useCallback((e: React.MouseEvent<SVGSVGElement>): Shape | null => {
    const { wx, wy } = worldFromSvgEvent(e);
    const threshWorld = 10 / scaleRef.current;
    for (let i = shapeOrdered.length - 1; i >= 0; i--) {
      const s = shapeOrdered[i];
      if (nearPerimeter(s, wx, wy, threshWorld)) return s;
    }
    return null;
  }, [shapeOrdered, worldFromSvgEvent]);

  // ===== Drag state =====
  type DragState =
    | { kind: "none" }
    | { kind: "creating"; start: { x: number; y: number }; ghost: Shape }
    | { kind: "moving"; id: string; grabOffset: { dx: number; dy: number } }
    | {
        kind: "resizing";
        id: string;
        startWorld: { x: number; y: number };
        start: Shape;
        lock: "x" | "y" | "uniform" | "corner";
        startHalf: { rx: number; ry: number };
        cornerSign?: { sx: 1 | -1; sy: 1 | -1 };
      }
    | { kind: "rotating"; id: string; startAngle: number; initialRot: number };

  const [drag, setDrag] = useState<DragState>({ kind: "none" });

  const moveRAF = useRef<number | null>(null);
  const scheduleMoveUpdate = (fn: () => void) => {
    if (moveRAF.current != null) return;
    moveRAF.current = requestAnimationFrame(() => {
      moveRAF.current = null;
      fn();
    });
  };

  const nearCorner = (
    s: Shape,
    wx: number,
    wy: number,
    threshWorld: number
  ): { type: "rect"; sx: 1 | -1; sy: 1 | -1 } | { type: "poly"; i: number } | null => {
    const sides = resolveSides(s.sides);
    const { lx, ly } = worldToLocal(s, wx, wy);
    const rx = Math.abs(s.width) / 2;
    const ry = Math.abs(s.height) / 2;

    if (sides === 4) {
      const candidates = [
        { sx:  1 as const, sy:  1 as const, cx:  rx, cy:  ry },
        { sx:  1 as const, sy: -1 as const, cx:  rx, cy: -ry },
        { sx: -1 as const, sy:  1 as const, cx: -rx, cy:  ry },
        { sx: -1 as const, sy: -1 as const, cx: -rx, cy: -ry },
      ];
      for (const c of candidates) {
        if (Math.hypot(lx - c.cx, ly - c.cy) <= threshWorld) {
          return { type: "rect", sx: c.sx, sy: c.sy };
        }
      }
      return null;
    }

    const n = sides === 0 ? 16 : sides;
    const start = -Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const a = start + (i * 2 * Math.PI) / n;
      const vx = rx * Math.cos(a), vy = ry * Math.sin(a);
      if (Math.hypot(lx - vx, ly - vy) <= threshWorld) return { type: "poly", i };
    }
    return null;
  };

  const cursorForPerimeter = (s: Shape, wx: number, wy: number, modForRotate: boolean) => {
    if (modForRotate) return "grab" as const;
    const sides = resolveSides(s.sides);
    const threshWorld = 10 / scaleRef.current;
    const corner = nearCorner(s, wx, wy, threshWorld);
    if (corner && corner.type === "rect") {
      const diag = (corner.sx === corner.sy) ? "nwse-resize" : "nesw-resize";
      return diag as "nwse-resize" | "nesw-resize";
    }
    if (sides === 4) {
      const { lx, ly } = worldToLocal(s, wx, wy);
      const rx = Math.abs(s.width) / 2;
      const ry = Math.abs(s.height) / 2;
      const dx = Math.abs(Math.abs(lx) - rx);
      const dy = Math.abs(Math.abs(ly) - ry);
      return (dx < dy) ? ("ew-resize" as const) : ("ns-resize" as const);
    }
    return "crosshair" as const;
  };

  // ===== Mouse handlers (left) =====
  const onLeftDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const { wx, wy } = worldFromSvgEvent(e);

    // perimeter first (resize/rotate)
    const peri = pickPerimeter(e);
    if (peri) {
      if (e.metaKey || e.ctrlKey) {
        const { cx, cy } = shapeCenter(peri);
        const ang0 = Math.atan2(wy - cy, wx - cx);
        setDrag({ kind: "rotating", id: peri.id, startAngle: ang0, initialRot: peri.rotation ?? 0 });
        return;
      }
      const threshWorld = 10 / scaleRef.current;
      const corner = nearCorner(peri, wx, wy, threshWorld);
      const sides = resolveSides(peri.sides);
      const theta = peri.rotation ?? 0;
      const { cx, cy } = shapeCenter(peri);
      const dxw = wx - cx, dyw = wy - cy;
      const c = Math.cos(-theta), si = Math.sin(-theta);
      const lx = dxw * c - dyw * si;
      const ly = dxw * si + dyw * c;
      const rx0 = Math.abs(peri.width) / 2;
      const ry0 = Math.abs(peri.height) / 2;

      if (corner) {
        const lock: "corner" | "uniform" = (corner.type === "rect") ? "corner" : "uniform";
        setDrag({
          kind: "resizing",
          id: peri.id,
          startWorld: { x: wx, y: wy },
          start: { ...peri },
          lock,
          startHalf: { rx: rx0, ry: ry0 },
          cornerSign: corner.type === "rect" ? { sx: corner.sx, sy: corner.sy } : undefined,
        });
        return;
      }

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
      return;
    }

    // inside shape: move/selection
    const picked = pickShapeEvt(e);
    if (picked) {
      // Store click start for potential text editing
      clickStartRef.current = { x: e.clientX, y: e.clientY, shapeId: picked.id };
      
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
      return;
    }

    // background: marquee (shift) or create
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
      z: undefined,
    };
    setDrag({ kind: "creating", start: { x: wx, y: wy }, ghost });
  }, [userId, shapes, selectedIds, pickPerimeter, pickShapeEvt, worldFromSvgEvent]);

  const onLeftMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const { wx, wy } = worldFromSvgEvent(e);

    if (marquee) { setMarquee(m => (m ? { ...m, curX: wx, curY: wy } : m)); return; }

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

    if (drag.kind === "creating") {
      setDrag({ kind: "creating", start: drag.start, ghost: { ...drag.ghost, width: wx - drag.start.x, height: wy - drag.start.y } });
      return;
    }

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

    if (drag.kind === "resizing") {
      const s0 = drag.start;
      const { cx, cy } = shapeCenter(s0);
      const theta = s0.rotation ?? 0;
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
      } else if (drag.lock === "uniform") {
        const kx = Math.abs(lx) / (drag.startHalf.rx || 1);
        const ky = Math.abs(ly) / (drag.startHalf.ry || 1);
        const k = Math.max(kx, ky, minHalf / Math.max(drag.startHalf.rx, drag.startHalf.ry));
        rx = Math.max(minHalf, drag.startHalf.rx * k);
        ry = Math.max(minHalf, drag.startHalf.ry * k);
      } else {
        rx = Math.max(minHalf, Math.abs(lx));
        ry = Math.max(minHalf, Math.abs(ly));
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
  }, [drag, marquee, worldFromSvgEvent]);

  const onLeftUp = useCallback(async (e: React.MouseEvent<SVGSVGElement>) => {
    // Check for text click FIRST (only if it was a click, not a drag)
    if (clickStartRef.current && drag.kind === "moving") {
      const dx = Math.abs(e.clientX - clickStartRef.current.x);
      const dy = Math.abs(e.clientY - clickStartRef.current.y);
      
      // If mouse barely moved, treat as click not drag
      if (dx < 5 && dy < 5 && clickStartRef.current.shapeId) {
        const s = shapesRef.current.get(clickStartRef.current.shapeId);
        if (s) {
          const { wx, wy } = worldFromSvgEvent(e);
          // Check if click was in text box area
          if (pointInTextBox(s, wx, wy)) {
            // Delay text editing to allow double-click to fire
            const shapeId = s.id;
            const textContent = s.text_md || "";
            setTimeout(() => {
              if (!dblClickRef.current) {
                setEditingTextId(shapeId);
                setEditingText(textContent);
              }
            }, 250); // Wait 250ms to see if double-click happens
            
            setDrag({ kind: "none" }); // Cancel the drag
            clickStartRef.current = null;
            return;
          }
        }
      }
      clickStartRef.current = null;
    }

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

    if (multiDragRef.current) { multiDragRef.current = null; return; }

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
        const name = wordlists ? randomName(wordlists.adjs, wordlists.nouns) : undefined;
        const shape: Shape = {
          id, created_by: userId,
          x: nx, y: ny, width: nw, height: nh,
          stroke: "#000000", stroke_width: 2, fill: "#ffffff",
          updated_at: nowIso(), sides: 4, rotation: 0, z: frontZ(),
          name,
          text_color: "#000000", // ADD THIS
        };
        upsertShapeLocal(shape);
        shapesChRef.current?.send({ type: "broadcast", event: "shape-create", payload: shape });
        const { error } = await supabase.from("shapes").insert(shape);
        if (error) { console.warn("DB insert failed, rolling back local:", error); removeShapeLocal(id); }
      }
      return;
    }

    if (drag.kind === "moving" || drag.kind === "resizing" || drag.kind === "rotating") {
      setDrag({ kind: "none" });
    }
  }, [drag, marquee, shapes, userId, upsertShapeLocal, removeShapeLocal, worldFromSvgEvent, wordlists]);

  // ===== Double-click delete =====
  const onDoubleClickSVG = useCallback(async (e: React.MouseEvent<SVGSVGElement>) => {
    dblClickRef.current = true; // Mark that double-click happened
    
    if (drag.kind !== "none") return;
    const hit = pickShapeEvt(e);
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
    
    // Clear the flag after a short delay
    setTimeout(() => {
      dblClickRef.current = false;
    }, 300);
  }, [drag, pickShapeEvt, selectedIds]);

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

  const handleTextChange = useCallback((text: string) => {
    setEditingText(text);
    
    if (textDebounceRef.current) clearTimeout(textDebounceRef.current);
    
    textDebounceRef.current = setTimeout(() => {
      if (!editingTextId) return;
      
      const now = nowIso();
      setShapes(prev => {
        const m = new Map(prev);
        const s = m.get(editingTextId);
        if (!s) return prev;
        m.set(editingTextId, { ...s, text_md: text, updated_at: now });
        return m;
      });

      shapesChRef.current?.send({
        type: "broadcast",
        event: "shape-text",
        payload: { id: editingTextId, text_md: text, updated_at: now }
      });

      (async () => {
        await supabase.from("shapes").update({ text_md: text, updated_at: now }).eq("id", editingTextId);
      })();
    }, 250);
  }, [editingTextId]);

  const handleTextBlur = useCallback(() => {
    if (textDebounceRef.current) {
      clearTimeout(textDebounceRef.current);
      textDebounceRef.current = null;
    }
    setEditingTextId(null);
  }, []);

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

  const deleteAnnotation = useCallback(async (id: string, shape_id: string) => {
    // optimistic remove
    setAnnotationsByShape(prev => {
      const m = new Map(prev);
      m.set(shape_id, (m.get(shape_id) ?? []).filter(a => a.id !== id));
      return m;
    });
    annotationsChRef.current?.send({ type: "broadcast", event: "annotation-delete", payload: { id, shape_id } });
    const { error } = await supabase.from("shape_annotations").delete().eq("id", id);
    if (error) {
      console.warn("Annotation delete failed:", error.message);
      // reload this shape’s annotations from DB as fallback
      try {
        const { data } = await supabase
          .from("shape_annotations")
          .select("id,shape_id,user_id,text,created_at")
          .eq("shape_id", shape_id)
          .order("created_at", { ascending: true });
        if (data) {
          setAnnotationsByShape(prev => {
            const m = new Map(prev);
            m.set(shape_id, (data as Annotation[]).filter(a => a.text && a.text.trim().length > 0));
            return m;
          });
        }
      } catch {}
    }
  }, []);

  const openModalForShape = useCallback(async (shapeId: string) => {
    setModalShapeId(shapeId);
    setAnnotationInput("");

    const s = shapesRef.current.get(shapeId);
    setSidesInput(String(resolveSides(s?.sides)));

    // Initialize style inputs
    setStrokeWidthInput(String(s?.stroke_width ?? 2));
    setStrokeColorInput(String(s?.stroke ?? "#000000"));
    setTextColorInput(String(s?.text_color ?? "#000000")); // NEW
    if (s?.fill == null) {
      setNoFill(true);
      setFillColorInput("#ffffff");
    } else {
      setNoFill(false);
      setFillColorInput(String(s.fill));
    }
    setLastColorTarget("stroke");

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

  const closeModal = useCallback(() => { setModalShapeId(null); setAnnotationInput(""); setPicker(null); }, []);

  const addAnnotation = useCallback(async () => {
    const text = annotationInput.trim();
    if (!text || !modalShapeId) return;

    const targetIds = (selectedIdsRef.current.size > 0 && selectedIdsRef.current.has(modalShapeId))
      ? Array.from(selectedIdsRef.current)
      : [modalShapeId];

    const now = nowIso();
    const anns: ShapeAnnotationInsert[] = targetIds.map((shapeId) => ({
      id: (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `ann_${Math.random().toString(36).slice(2)}`,
      shape_id: shapeId,
      user_id: userId,
      text,
      created_at: now,
    }));

    setAnnotationsByShape(prev => {
      const m = new Map(prev);
      for (const ann of anns) {
        const arr = m.get(ann.shape_id) ?? [];
        m.set(ann.shape_id, [...arr, ann]);
      }
      return m;
    });

    setAnnotationInput("");

    for (const ann of anns) {
      annotationsChRef.current?.send({
        type: "broadcast",
        event: "annotation-upsert",
        payload: ann,
      });
    }

    const { error } = await supabase.from("shape_annotations").insert(anns);
    if (error) {
      console.warn("Annotation insert failed:", error.message);
      setAnnotationsByShape(prev => {
        const m = new Map(prev);
        for (const ann of anns) {
          const arr = (m.get(ann.shape_id) ?? []).filter(a => a.id !== ann.id);
          m.set(ann.shape_id, arr);
        }
        return m;
      });
    }
  }, [annotationInput, modalShapeId, userId]);

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

  // ===== Style save (stroke width, stroke color, fill color) =====
  const saveStyle = useCallback(async () => {
    if (!modalShapeId) return;

    const sw = Number(strokeWidthInput);
    const strokeHex = normalizeHex(strokeColorInput || "");
    const fillHex = noFill ? null : normalizeHex(fillColorInput || "");
    const textHex = normalizeHex(textColorInput || ""); // NEW

    if (!Number.isFinite(sw) || sw <= 0 || !strokeHex || (!noFill && !fillHex) || !textHex) { // UPDATED
      const s = shapesRef.current.get(modalShapeId);
      if (s) {
        if (!Number.isFinite(sw) || sw <= 0) setStrokeWidthInput(String(s.stroke_width));
        if (!strokeHex) setStrokeColorInput(s.stroke);
        if (!noFill && !fillHex) setFillColorInput(s.fill ?? "#ffffff");
        if (!textHex) setTextColorInput(s.text_color ?? "#000000"); // NEW
      }
      return;
    }

    const ids = (selectedIdsRef.current.size > 0 && selectedIdsRef.current.has(modalShapeId))
      ? Array.from(selectedIdsRef.current)
      : [modalShapeId];

    const now = nowIso();
    setShapes(prev => {
      const m = new Map(prev);
      for (const id of ids) {
        const s = m.get(id); if (!s) continue;
        m.set(id, {
          ...s,
          stroke: strokeHex,
          stroke_width: sw,
          fill: fillHex,
          text_color: textHex, // NEW
          updated_at: now
        });
      }
      return m;
    });

    shapesChRef.current?.send({
      type: "broadcast",
      event: "shape-style",
      payload: { ids, stroke: strokeHex, fill: fillHex, stroke_width: sw, text_color: textHex, updated_at: now } // UPDATED
    });

    try {
      const { error } = await supabase
        .from("shapes")
        .update({ stroke: strokeHex, stroke_width: sw, fill: fillHex, text_color: textHex, updated_at: now }) // UPDATED
        .in("id", ids);
      if (error) console.warn("Update style failed:", error.message);
    } catch (err) { console.warn("Update style exception:", err); }

    addRecentColor(strokeHex);
    if (fillHex) addRecentColor(fillHex);
    addRecentColor(textHex); // NEW
  }, [modalShapeId, strokeWidthInput, strokeColorInput, fillColorInput, textColorInput, noFill]); // UPDATED dependencies

  // ===== z-index helpers/buttons =====
  // helper to update z for a set of ids to specific values (per-id)
  function updateZIndexed(ids: string[], zById: Record<string, number>) {
    const now = new Date().toISOString();

    // Update React state (new Map -> re-render), and mirror to ref
    setShapes(prev => {
      const next = new Map(prev);
      for (const id of ids) {
        const cur = next.get(id);
        if (cur) {
          const updated = { ...cur, z: zById[id], updated_at: now };
          next.set(id, updated);
          shapesRef.current.set(id, updated);
        }
      }
      return next;
    });

    // Persist to DB (best-effort)
    (async () => {
      try {
        for (const id of ids) {
          const cur = shapesRef.current.get(id);
          if (cur) {
            await supabase.from("shapes")
              .update({ z: cur.z, updated_at: cur.updated_at })
              .eq("id", id);
          }
        }
      } catch (e) {
        console.error("z-index update failed", e);
      }
    })();
  }

  const saveZIndex = useCallback(() => {
    if (!modalShapeId) return;
    const v = Number(zIndexInput);
    if (!Number.isFinite(v)) return;

    const ids = (selectedIds.size > 0 && selectedIds.has(modalShapeId))
      ? Array.from(selectedIds)
      : [modalShapeId];

    const zById: Record<string, number> = {};
    for (const id of ids) zById[id] = v;

    updateZIndexed(ids, zById);
  }, [modalShapeId, selectedIds, zIndexInput]);

  // Helper: selected-or-current ids
  const targetIdsForModal = () => {
    if (!modalShapeId) return [] as string[];
    return (selectedIds.size > 0 && selectedIds.has(modalShapeId))
      ? Array.from(selectedIds)
      : [modalShapeId];
  };

  // Helper: compute min/max z across all shapes
  const getZBounds = () => {
    let minZ = Infinity, maxZ = -Infinity, any = false;
    for (const s of shapesRef.current.values()) {
      const z = Number.isFinite(s.z as number) ? (s.z as number) : 0;
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
      any = true;
    }
    if (!any) return { minZ: 0, maxZ: 0 };
    return { minZ, maxZ };
  };

  const sendToFront = useCallback(() => {
    // find current maxZ
    let maxZ = 0;
    for (const s of shapes.values()) maxZ = Math.max(maxZ, s.z ?? 0);

    const ids = (selectedIds.size > 0 && modalShapeId && selectedIds.has(modalShapeId))
      ? Array.from(selectedIds)
      : (modalShapeId ? [modalShapeId] : []);

    let z = maxZ + 1;
    const zById: Record<string, number> = {};
    for (const id of ids) zById[id] = z++;

    updateZIndexed(ids, zById);
  }, [shapes, selectedIds, modalShapeId]);

  const sendToBack = useCallback(() => {
    // find current minZ
    let minZ = 0;
    let first = true;
    for (const s of shapes.values()) {
      const z = s.z ?? 0;
      if (first) { minZ = z; first = false; } else { minZ = Math.max(Math.min(minZ, z), Math.min(minZ, z)); minZ = Math.min(minZ, z); }
    }

    const ids = (selectedIds.size > 0 && modalShapeId && selectedIds.has(modalShapeId))
      ? Array.from(selectedIds)
      : (modalShapeId ? [modalShapeId] : []);

    // preserve relative order: assign consecutive z’s below minZ
    let z = minZ - ids.length;
    const zById: Record<string, number> = {};
    for (const id of ids) zById[id] = z++;

    updateZIndexed(ids, zById);
  }, [shapes, selectedIds, modalShapeId]);

  // ===== hover cursor =====
  const updateHoverCursor = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (drag.kind !== "none") return;
    const { wx, wy } = worldFromSvgEvent(e);
    const threshWorld = 10 / scaleRef.current;
    let hovered: string | null = null;

    for (let i = shapeOrdered.length - 1; i >= 0; i--) {
      const s = shapeOrdered[i];
      if (pointInShape(s, wx, wy) || nearPerimeter(s, wx, wy, threshWorld)) {
        hovered = s.id;
        setSvgCursor(cursorForPerimeter(s, wx, wy, e.metaKey || e.ctrlKey));
        break;
      }
    }
    if (!hovered) setSvgCursor("default");
    setHoveredId(hovered);
  }, [drag.kind, shapeOrdered, worldFromSvgEvent]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      // close on left click outside
      if ((e as MouseEvent).button === 0) setShowCanvasMenu(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowCanvasMenu(false); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, []);

  // ===== Render =====
  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-white select-none"
      onMouseDown={onMouseDownRoot}
      onMouseMove={onMouseMoveRoot}
      onMouseUp={onMouseUpRoot}
      onContextMenu={onContextMenuRoot}
    >
      {/* Dot grid */}
      <canvas
        ref={gridCanvasRef}
        className="absolute inset-0 block w-full h-full pointer-events-none"
        aria-hidden
      />

      {/* Shapes (SVG) */}
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: svgCursor }}
        onMouseDown={onLeftDown}
        onMouseMove={(e) => { updateHoverCursor(e); onLeftMove(e); }}
        onMouseLeave={() => { setSvgCursor("default"); setHoveredId(null); }}
        onMouseUp={onLeftUp}
        onDoubleClick={onDoubleClickSVG}
      >
        <defs>
          <filter id="selGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#3b82f6" floodOpacity="0.9" />
          </filter>
        </defs>
        <g transform={`translate(${-offset.x * scale}, ${-offset.y * scale}) scale(${scale})`}>
          {shapeOrdered.map((s) => {
            // Coerce sides to a number (export can see "6" as a string)
            const rawSides = (typeof s.sides === "number") ? s.sides : parseInt(String(s.sides ?? ""), 10);
            const sides = resolveSides(Number.isFinite(rawSides) ? rawSides : undefined);
            const x = Math.min(s.x, s.x + s.width);
            const y = Math.min(s.y, s.y + s.height);
            const w = Math.abs(s.width);
            const h = Math.abs(s.height);
            const strokeW = s.stroke_width / scale;
            const rotDeg = deg(s.rotation ?? 0);
            const { cx, cy } = shapeCenter(s);

            const shapeProps = {
              fill: s.fill ?? "transparent",
              stroke: s.stroke,
              strokeWidth: strokeW,
              pointerEvents: "all" as const,
              style: { cursor: "inherit" },
              filter: selectedIds.has(s.id) ? "url(#selGlow)" : undefined,
              transform: rotDeg ? `rotate(${rotDeg} ${cx} ${cy})` : undefined,
            };

            const isEditing = editingTextId === s.id;

            // ---- text_md-in-SVG (foreignObject) setup ----
            const hasMD = !!(s.text_md && s.text_md.trim());
            const { boxW, boxH } = getTextBoxBounds(s); // your existing helper
            const boxX = cx - boxW / 2;                 // world coords
            const boxY = cy - boxH / 2;                 // world coords
            const foFontSize = Math.max(10, 14 / scale); // screen-stable sizing
            const textColor =
              s.text_color && HEX_RE.test(s.text_color) ? s.text_color : "#000000";

            let node: React.ReactNode;
            if (sides === 4) {
              node = <rect x={x} y={y} width={w} height={h} {...shapeProps} />;
            } else if (sides === 0) {
              node = <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...shapeProps} />;
            } else {
              node = <polygon points={polygonPoints(x, y, w, h, sides)} {...shapeProps} />;
            }

            return (
              <g
                key={s.id}
                data-shape-id={s.id}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openModalForShape(s.id); }}
              >
                {/* shape path */}
                {node}

                {/* text_md rendered inside the same group so it shares z-index */}
                {hasMD && !isEditing && (
                  <foreignObject
                    x={boxX}
                    y={boxY}
                    width={boxW}
                    height={boxH}
                    transform={rotDeg ? `rotate(${rotDeg} ${cx} ${cy})` : undefined}
                    style={{ pointerEvents: "none" }} // display only; editing uses HTML overlay
                    requiredExtensions="http://www.w3.org/1999/xhtml" // optional, OK on <foreignObject>
                  >
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        overflow: "hidden", // clip to box; switch to 'auto' if you want scrollbars
                        color: textColor,
                        fontSize: `${foFontSize}px`,
                        lineHeight: "1.25",
                        fontFamily:
                          "ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial",
                      }}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(s.text_md!) }}
                    />
                  </foreignObject>
                )}
              </g>
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
        {/* Marquee (screen coords) */}
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
      {/* Text boxes overlay (editing only) */}
      <div className="absolute inset-0 pointer-events-none z-20">
        {shapeOrdered.map((s) => {
          const isEditing = editingTextId === s.id;
          if (!isEditing) return null;

          const { cx, cy } = shapeCenter(s);
          const { boxW, boxH } = getTextBoxBounds(s);

          const screenX = (cx - offset.x) * scale;
          const screenY = (cy - offset.y) * scale;
          const screenW = boxW * scale;
          const screenH = boxH * scale;

          const zForEditor = 1000 + (Number.isFinite(s.z as number) ? (s.z as number) : 0);

          return (
            <div
              key={`text-editor-${s.id}`}
              className="absolute"
              style={{
                left: screenX - screenW / 2,
                top: screenY - screenH / 2,
                width: screenW,
                height: screenH,
                pointerEvents: "auto",
                zIndex: zForEditor,
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <textarea
                className="w-full h-full p-2 text-sm border-2 border-blue-500 rounded bg-white resize-none outline-none"
                style={{ fontSize: Math.max(10, 14 * scale) }}
                value={editingText}
                onChange={(e) => handleTextChange(e.target.value)}
                onBlur={handleTextBlur}
                autoFocus
              />
            </div>
          );
        })}
      </div>
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

      {/* Hover name label */}
      {hoveredId && (() => {
        const s = shapesRef.current.get(hoveredId);
        if (!s || !s.name) return null;
        // position near the top-left of the shape in screen space
        const x = Math.min(s.x, s.x + s.width);
        const y = Math.min(s.y, s.y + s.height);
        const sx = (x - offsetRef.current.x) * scaleRef.current;
        const sy = (y - offsetRef.current.y) * scaleRef.current;

        return (
          <div
            className="absolute pointer-events-none"
            style={{ transform: `translate(${sx + 8}px, ${sy - 24}px)` }}
          >
            <div className="rounded-md bg-black/80 px-2 py-1 text-xs text-white shadow">
              {s.name}
            </div>
          </div>
        );
      })()} 

      {/* Properties & Annotations Modal */}
      {modalShapeId && (() => {
        const s = shapesRef.current.get(modalShapeId);
        const email = profiles.get(userId) ?? userId;
        if (!s) return null;
        const ownerEmail = profiles.get(s.created_by) ?? s.created_by; // NEW
        const anns = annotationsByShape.get(modalShapeId) ?? [];
        return (
          <div className="absolute inset-0 z-50 flex items-center justify-center" aria-modal role="dialog">
            <div className="absolute inset-0 bg-black/40" onClick={closeModal} />
            <div className="relative z-10 w-[660px] max-w-[92vw] rounded-2xl bg-white p-5 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">
                    Shape Properties{ s.name ? ` — ${s.name}` : "" /* show name if present */ }
                  </h2>
                  {!s.name && (
                    <div className="text-xs text-gray-500">(unnamed)</div>
                  )}
                </div>
                <button
                  className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
                  onClick={closeModal}
                  aria-label="Close properties"
                >
                  ✕
                </button>
              </div>

              {/* Basic */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">ID:</span> {s.id}</div>
                <div><span className="text-gray-500">Owner:</span> {ownerEmail}</div> {/* CHANGED */}
                <div><span className="text-gray-500">X:</span> {s.x}</div>
                <div><span className="text-gray-500">Y:</span> {s.y}</div>
                <div><span className="text-gray-500">Width:</span> {s.width}</div>
                <div><span className="text-gray-500">Height:</span> {s.height}</div>
                <div><span className="text-gray-500">Rotation:</span> {Math.round(deg(s.rotation ?? 0))}°</div>
                <div><span className="text-gray-500">Updated:</span> {s.updated_at ? new Date(s.updated_at).toLocaleString() : "—"}</div>
              </div>

              {/* Layering */}
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-medium">Layering</h3>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex gap-2">
                    <button
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                      onClick={sendToFront}
                    >
                      Send to front
                    </button>
                    <button
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                      onClick={sendToBack}
                    >
                      Send to back
                    </button>
                  </div>

                  {/* exact z-index setter */}
                  <div className="ml-auto flex items-end gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-gray-600">Z-index (integer)</label>
                      <input
                        type="number"
                        step={1}
                        className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                        value={zIndexInput}
                        onChange={(e) => setZIndexInput(e.target.value)}
                        onBlur={(e) => {
                          // sanitize to integer on blur
                          const n = Math.round(Number(e.target.value));
                          if (Number.isFinite(n)) setZIndexInput(String(n));
                        }}
                      />
                    </div>
                    <button
                      className="h-9 shrink-0 rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      onClick={saveZIndex}
                      disabled={!Number.isFinite(Number(zIndexInput))}
                      title={
                        selectedIds.size > 0 && selectedIds.has(modalShapeId!)
                          ? `Apply to ${selectedIds.size} selected`
                          : "Apply to this shape"
                      }
                    >
                      Set Z
                    </button>
                  </div>
                </div>

                {selectedIds.size > 0 && selectedIds.has(modalShapeId!) && (
                  <div className="mt-1 text-xs text-gray-500">
                    Applies to {selectedIds.size} selected shape{selectedIds.size > 1 ? "s" : ""}.
                  </div>
                )}
              </div>

              {/* Geometry */}
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-medium">Geometry</h3>
                <div className="flex items-end gap-3">
                  <div className="grow">
                    <label className="mb-1 block text-xs text-gray-600">Number of sides (0 = ellipse, 3+ = polygon)</label>
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
                  </div>
                  <button
                    className="h-9 shrink-0 rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    onClick={saveSides}
                    disabled={(() => { const v = Number(sidesInput); return !(v === 0 || v >= 3); })()}
                  >Save sides</button>
                </div>
                {selectedIds.size > 0 && selectedIds.has(modalShapeId!) && (
                  <div className="mt-1 text-xs text-gray-500">
                    Applies to {selectedIds.size} selected shape{selectedIds.size > 1 ? "s" : ""}.
                  </div>
                )}
              </div>

              {/* Style */}
              <div className="mt-5">
                <h3 className="mb-2 text-sm font-medium">Style</h3>

                {/* Stroke width */}
                <div className="mb-3 flex items-end gap-3">
                  <div className="w-44">
                    <label className="mb-1 block text-xs text-gray-600">Stroke width (px)</label>
                    <input
                      type="number"
                      step="0.5"
                      min={0.5}
                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                      value={strokeWidthInput}
                      onChange={(e) => setStrokeWidthInput(e.target.value)}
                      onFocus={() => setLastColorTarget("stroke")}
                    />
                  </div>
                </div>

                {/* Stroke color */}
                <div className="mb-3 grid grid-cols-[1fr_auto] items-end gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">Stroke color (hex)</label>
                    <div className="flex items-center gap-3">
                      <input
                        className={`w-full rounded-md border px-2 py-1.5 text-sm outline-none ${HEX_RE.test(strokeColorInput) ? "border-gray-300 focus:border-blue-500" : "border-red-400 focus:border-red-500"}`}
                        placeholder="#000000"
                        value={strokeColorInput}
                        onChange={(e) => setStrokeColorInput(e.target.value)}
                        onFocus={() => setLastColorTarget("stroke")}
                      />
                      <button
                        type="button"
                        className="aspect-square w-12 rounded border border-gray-300"  // was: "h-9 w-12 ..."
                        style={{
                          background: HEX_RE.test(strokeColorInput)
                            ? strokeColorInput
                            : "repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50%/10px 10px"
                        }}
                        onClick={(e) => {
                          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                          setLastColorTarget("stroke");

                          const safeInitial = HEX6.test(strokeColorInput) ? strokeColorInput : "#000000"; // fallback
                          setPicker({
                            for: "stroke",
                            x: rect.left + window.scrollX,
                            y: rect.bottom + 6 + window.scrollY,
                            initial: safeInitial,   // NEW
                          });
                        }}
                        title="Pick stroke color"
                      />
                    </div>
                    {!HEX_RE.test(strokeColorInput) && (
                      <div className="mt-1 text-xs text-red-600">Enter a valid hex like #ffcc00 or #fc0</div>
                    )}
                  </div>
                  <div className="self-center text-xs text-gray-500">Preview</div>
                </div>

                {/* Fill color */}
                <div className="mb-3 grid grid-cols-[1fr_auto] items-end gap-3">
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="block text-xs text-gray-600">Fill color (hex)</label>
                      <label className="flex select-none items-center gap-2 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={noFill}
                          onChange={(e) => { setNoFill(e.target.checked); setLastColorTarget("fill"); }}
                        />
                        No fill (transparent)
                      </label>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        className={`w-full rounded-md border px-2 py-1.5 text-sm outline-none ${noFill || HEX_RE.test(fillColorInput) ? "border-gray-300 focus:border-blue-500" : "border-red-400 focus:border-red-500"}`}
                        placeholder="#ffffff"
                        value={fillColorInput}
                        onChange={(e) => setFillColorInput(e.target.value)}
                        onFocus={() => setLastColorTarget("fill")}
                        disabled={noFill}
                      />
                      <button
                        type="button"
                        className="aspect-square w-12 rounded border border-gray-300"  // was: "h-9 w-12 ..."
                        style={{
                          background: noFill
                            ? "repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50%/10px 10px"
                            : (HEX_RE.test(fillColorInput) ? fillColorInput : "repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50%/10px 10px")
                        }}
                        onClick={(e) => {
                          if (noFill) setNoFill(false);
                          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                          setLastColorTarget("fill");

                          const safeInitial = noFill
                            ? "#ffffff"
                            : (HEX6.test(fillColorInput) ? fillColorInput : "#ffffff"); // fallback
                          setPicker({
                            for: "fill",
                            x: rect.left + window.scrollX,
                            y: rect.bottom + 6 + window.scrollY,
                            initial: safeInitial,   // NEW
                          });
                        }}
                        title="Pick fill color"
                      />
                    </div>
                    {!noFill && !HEX_RE.test(fillColorInput) && (
                      <div className="mt-1 text-xs text-red-600">Enter a valid hex like #66ccff or #6cf</div>
                    )}
                  </div>
                  <div className="self-center text-xs text-gray-500">Preview</div>
                </div>
                {/* Text color */}
                <div className="mb-3 grid grid-cols-[1fr_auto] items-end gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">Text color (hex)</label>
                    <div className="flex items-center gap-3">
                      <input
                        className={`w-full rounded-md border px-2 py-1.5 text-sm outline-none ${HEX_RE.test(textColorInput) ? "border-gray-300 focus:border-blue-500" : "border-red-400 focus:border-red-500"}`}
                        placeholder="#000000"
                        value={textColorInput}
                        onChange={(e) => setTextColorInput(e.target.value)}
                        onFocus={() => setLastColorTarget("text")}
                      />
                      <button
                        type="button"
                        className="aspect-square w-12 rounded border border-gray-300"
                        style={{
                          background: HEX_RE.test(textColorInput)
                            ? textColorInput
                            : "repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50%/10px 10px"
                        }}
                        onClick={(e) => {
                          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                          setLastColorTarget("text");

                          const safeInitial = HEX6.test(textColorInput) ? textColorInput : "#000000";
                          setPicker({
                            for: "text",
                            x: rect.left + window.scrollX,
                            y: rect.bottom + 6 + window.scrollY,
                            initial: safeInitial,
                          });
                        }}
                        title="Pick text color"
                      />
                    </div>
                    {!HEX_RE.test(textColorInput) && (
                      <div className="mt-1 text-xs text-red-600">Enter a valid hex like #000000 or #000</div>
                    )}
                  </div>
                  <div className="self-center text-xs text-gray-500">Preview</div>
                </div>
                {/* Recent colors + target toggle */}
                {recentColors.length > 0 && (
                  <div className="mb-1 flex items-center gap-2 text-xs text-gray-600">
                    <span>Recent colors</span>
                    <div className="ml-auto flex gap-1">
                      <button
                        className={`rounded px-2 py-0.5 ${lastColorTarget === "stroke" ? "bg-gray-200" : "hover:bg-gray-100"}`}
                        onClick={() => setLastColorTarget("stroke")}
                        title="Apply to stroke"
                      >
                        Stroke
                      </button>
                      <button
                        className={`rounded px-2 py-0.5 ${lastColorTarget === "fill" ? "bg-gray-200" : "hover:bg-gray-100"}`}
                        onClick={() => setLastColorTarget("fill")}
                        title="Apply to fill"
                      >
                        Fill
                      </button>
                      <button
                        className={`rounded px-2 py-0.5 ${lastColorTarget === "text" ? "bg-gray-200" : "hover:bg-gray-100"}`}
                        onClick={() => setLastColorTarget("text")}
                        title="Apply to text"
                      >
                        Text
                      </button>
                    </div>
                  </div>
                )}
                {recentColors.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {recentColors.map((c) => (
                      <button
                        key={c}
                        className="aspect-square w-8 rounded border border-gray-300"
                        style={{ background: c }}
                        title={`${c} → ${lastColorTarget}`}
                        onClick={() => {
                          if (lastColorTarget === "stroke") setStrokeColorInput(c);
                          else if (lastColorTarget === "fill") setFillColorInput(c);
                          else setTextColorInput(c); // NEW
                        }}
                      />
                    ))}
                  </div>
                )}

                <div className="mt-2 flex items-center justify-end gap-2">
                  <button className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100" onClick={closeModal}>Close</button>
                  <button
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    onClick={saveStyle}
                    disabled={
                      !Number.isFinite(Number(strokeWidthInput)) ||
                      Number(strokeWidthInput) <= 0 ||
                      !HEX_RE.test(strokeColorInput) ||
                      (!noFill && !HEX_RE.test(fillColorInput)) ||
                      !HEX_RE.test(textColorInput) // NEW
                    }
                  >
                    Save style
                  </button>
                </div>

                {selectedIds.size > 0 && selectedIds.has(modalShapeId!) && (
                  <div className="mt-1 text-xs text-gray-500">
                    Applies to {selectedIds.size} selected shape{selectedIds.size > 1 ? "s" : ""}.
                  </div>
                )}
              </div>

              {/* Annotations */}
              <div className="mt-6">
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
                  <label className="mb-1 block text-xs text-gray-600">
                    Add annotation (as {email})
                  </label>
                  {selectedIds.size > 0 && selectedIds.has(modalShapeId!) && (
                    <div className="mb-1 text-xs text-gray-500">
                      This note will be added to {selectedIds.size} selected shape{selectedIds.size > 1 ? "s" : ""}.
                    </div>
                  )}
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
      {/* Canvas Context Menu */}
      <Portal>
        {showCanvasMenu && canvasMenuPos && (
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[9999] rounded-xl shadow-2xl bg-white border border-gray-200"
            style={{ left: canvasMenuPos.x, top: canvasMenuPos.y, minWidth: 280 }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <div className="flex text-sm">
              <button
                className={`px-3 py-2 ${canvasMenuTab==='export' ? 'font-semibold border-b-2 border-blue-500' : 'text-gray-500'}`}
                onClick={() => setCanvasMenuTab('export')}
              >
                Export
              </button>
              <button
                className={`px-3 py-2 ${canvasMenuTab==='versions' ? 'font-semibold border-b-2 border-blue-500' : 'text-gray-500'}`}
                onClick={() => setCanvasMenuTab('versions')}
              >
                Versions
              </button>
              <div className="ml-auto px-2 py-2">
                <button className="text-gray-400 hover:text-gray-700" onClick={() => setShowCanvasMenu(false)}>✕</button>
              </div>
            </div>

            {canvasMenuTab === 'export' && (
              <div className="p-3 space-y-2">
                <button className="w-full rounded-md border px-3 py-2 hover:bg-gray-50" onClick={exportAsPNG}>Download PNG</button>
                <button className="w-full rounded-md border px-3 py-2 hover:bg-gray-50" onClick={exportAsSVG}>Download SVG</button>
                <button className="w-full rounded-md border px-3 py-2 hover:bg-gray-50" onClick={exportAsJSON}>Download JSON (state)</button>
              </div>
            )}

            {canvasMenuTab === 'versions' && (
              <div className="p-3 space-y-3">
                <div className="flex gap-2">
                  <button className="flex-1 rounded-md border px-3 py-2 hover:bg-gray-50" onClick={saveCanvasVersion}>
                    Save current version
                  </button>
                </div>
                <div className="max-h-64 overflow-auto divide-y">
                  {canvasVersions.length === 0 ? (
                    <div className="text-sm text-gray-500 py-6 text-center">No versions yet.</div>
                  ) : canvasVersions.map(v => (
                    <div key={v.id} className="py-2 flex items-center justify-between gap-3">
                      <div className="text-xs">
                        <div className="font-medium">{new Date(v.created_at).toLocaleString()}</div>
                        <div className="text-gray-500">by {v.created_by}</div>
                      </div>
                      <button
                        className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                        onClick={() => void restoreCanvasVersion(v.id)}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Portal>
      {/* Debug HUD */}
      {showDebug && (
        <div className="absolute bottom-3 left-3 rounded bg-white/80 px-3 py-2 text-xs shadow">
          <div>scroll: ({Math.round(offset.x)}, {Math.round(offset.y)})</div>
          <div>zoom: {scale.toFixed(2)}×</div>
          <div>cursorΔ: ({Math.round(cursor.dx)}, {Math.round(cursor.dy)})</div>
          <div>sum: ({Math.round(offset.x + cursor.dx)}, {Math.round(offset.y + cursor.dy)})</div>
          <div className="opacity-60">
            Wheel pan • RMB pan • Ctrl/Cmd+Wheel zoom • LMB create/move • Perimeter drag = resize • Cmd/Ctrl+Perimeter drag = rotate • Dbl-click delete (sel=all) • Shift+Click select • Shift+Drag (bg) marquee • Cmd/Ctrl+C/X/V • RMB on shape → Properties • Click text to edit • RMB on background → Canvas menu • ? toggles HUD
          </div>
        </div>
      )}
      {/* Global Color Picker (always above) */}
      {picker && <Portal><div className="fixed left-2 top-2 z-[10000] bg-black text-white px-2 py-1">picker on</div></Portal>}
      {picker && (
        <Portal>
          <div style={{ position: "fixed", inset: 0, zIndex: 2147483646, pointerEvents: "none" }}>
            {/* Pointer events enabled only on the picker itself */}
            <ColorPickerPopover
              x={picker.x}
              y={picker.y}
              initial={picker.initial || "#000000"}
              recent={recentColors}
              onClose={() => setPicker(null)}
              onPick={(hex) => {
                if (picker.for === "stroke") setStrokeColorInput(hex);
                else if (picker.for === "fill") setFillColorInput(hex);
                else setTextColorInput(hex); // NEW
              }}
              onPickRecent={(hex) => {
                if (picker.for === "stroke") setStrokeColorInput(hex);
                else if (picker.for === "fill") setFillColorInput(hex);
                else setTextColorInput(hex); // NEW
              }}
            />
          </div>
        </Portal>
      )}
      {/* AI ChatBox */}
      <Portal>
        <ChatBox
          onPanToCoordinate={panToCoordinate}
          canvasState={{
            centerX: offset.x + (svgRef.current?.getBoundingClientRect().width ?? 0) / 2 / scale,
            centerY: offset.y + (svgRef.current?.getBoundingClientRect().height ?? 0) / 2 / scale,
            scale,
            viewportWidth: svgRef.current?.getBoundingClientRect().width ?? 0,
            viewportHeight: svgRef.current?.getBoundingClientRect().height ?? 0,
          }}
          getCanvasJSON={encodeCanvasToJSON}
          getSelectedShapeIds={getSelectedShapeIds}
          getUserCursors={getUserCursors}
          getUIState={getUIState}
          aiGetViewport={aiGetViewport}
          aiUpdateShapeProperties={aiUpdateShapeProperties}
          aiRenameShape={aiRenameShape}
          aiAddAnnotation={aiAddAnnotation}
          aiAddToSelection={aiAddToSelection}
          aiRemoveFromSelection={aiRemoveFromSelection}
          aiClearSelection={aiClearSelection}
          aiCreateShape={aiCreateShape}
          aiDeleteShapes={aiDeleteShapes}
          aiToggleShapeModal={aiToggleShapeModal}
          aiToggleDebugHUD={aiToggleDebugHUD}
          aiToggleCanvasMenu={aiToggleCanvasMenu}
          aiDownloadPNG={aiDownloadPNG}
          aiDownloadSVG={aiDownloadSVG}
          aiDownloadJSON={aiDownloadJSON}
          aiSaveVersion={aiSaveVersion}
          aiRestoreVersion={aiRestoreVersion}
          aiSetZoom={aiSetZoom}
          aiSetPan={aiSetPan}
          aiCreateShapes={aiCreateShapes}
          aiAddAnnotations={aiAddAnnotations}
          aiUpdateShapesProperties={aiUpdateShapesProperties}
          aiUpdateSelectionProperties={aiUpdateSelectionProperties}
        />
      </Portal>
    </div>
  );
}

/* =========================
   Color Picker (popover)
   ========================= */
// --- Robust full-HSV ColorPickerPopover (handles invalid initial) ---
type ColorPickerPopoverProps = {
  x: number;
  y: number;
  initial: string;                 // may be invalid; we'll coerce
  recent: string[];
  onClose: () => void;
  onPick: (hex: string) => void;
  onPickRecent: (hex: string) => void;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const ColorPickerPopover: React.FC<ColorPickerPopoverProps> = ({
  x, y, initial, recent, onClose, onPick, onPickRecent,
}) => {
  // Coerce initial to a valid hex & HSV
  const initHex = HEX6.test(initial) ? initial : "#000000";
  const initRgb = hexToRgb(initHex)!;
  const initHsv = rgbToHsv(initRgb.r, initRgb.g, initRgb.b);

  const [h, setH] = useState(initHsv.h);     // 0..360
  const [s, setS] = useState(initHsv.s);     // 0..1
  const [v, setV] = useState(initHsv.v);     // 0..1
  const [hex, setHex] = useState(initHex);

  const svRef = useRef<HTMLDivElement | null>(null);
  const hRef  = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const next = hsvToHex(h, s, v);
    setHex(next);
    onPick(next); // live updates
  }, [h, s, v, onPick]);

  const startDragSV = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = svRef.current!.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      const nx = clamp01((ev.clientX - rect.left) / rect.width);       // S
      const ny = clamp01(1 - (ev.clientY - rect.top) / rect.height);   // V
      setS(nx); setV(ny);
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    move(e.nativeEvent as unknown as MouseEvent);
  };

  const startDragH = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = hRef.current!.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      const ny = clamp01((ev.clientY - rect.top) / rect.height);
      setH(ny * 360);
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    move(e.nativeEvent as unknown as MouseEvent);
  };

  const setFromHex = (hexStr: string) => {
    const rgb = hexToRgb(hexStr);
    if (!rgb) return;
    const nhsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    setH(nhsv.h);
    setS(nhsv.s);
    setV(nhsv.v);
    setHex(hexStr);
    onPick(hexStr);           // notify parent with the new color
  };

  const hueGradient = {
    background:
      "linear-gradient(to bottom,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
  };
  const baseColor = hsvToHex(h, 1, 1);
  const svBg = {
    background: `
      linear-gradient(to top, #000, rgba(0,0,0,0)),
      linear-gradient(to right, #fff, ${baseColor})
    `
  };

  const svMarkerStyle: React.CSSProperties = {
    position: "absolute",
    left: `${s * 100}%`,
    bottom: `${v * 100}%`,
    transform: "translate(-50%, 50%)",
    width: 12, height: 12,
    borderRadius: 9999,
    border: "2px solid white",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
    pointerEvents: "none",
  };
  const hMarkerStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: `calc(${(h / 360) * 100}% - 6px)`,
    width: "100%",
    height: 12,
    border: "2px solid white",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
    borderRadius: 6,
    pointerEvents: "none",
  };

  return (
    <div
      data-test-id="color-picker-root"
      className="fixed"
      style={{
        left: x,
        top: y,
        zIndex: 2147483647,
        pointerEvents: "auto",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="rounded-xl bg-white p-3 shadow-2xl ring-1 ring-black/10"
        // don't rely on w-[320px]
        style={{ width: 320 }}
      >
        {/* Preview + hex */}
        <div className="mb-3 flex items-center gap-3">
          <div className="aspect-square w-10 rounded border border-gray-300" style={{ background: hex }} title={hex} />
          <input
            className="h-9 grow rounded border border-gray-300 px-2 text-sm outline-none focus:border-blue-500 font-mono"
            value={hex}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (HEX6.test(v)) {
                const rgb = hexToRgb(v)!;
                const nhsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
                setH(nhsv.h); setS(nhsv.s); setV(nhsv.v);
                setHex(v);
                onPick(v);
              } else {
                setHex(v);
              }
            }}
            onBlur={() => {
              if (!HEX6.test(hex)) setHex(hsvToHex(h, s, v));
            }}
            placeholder="#RRGGBB"
          />
          <button className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100" onClick={onClose}>Close</button>
        </div>

        {/* SV + Hue */}
        <div className="flex gap-3">
          <div
            ref={svRef}
            onMouseDown={startDragSV}
            className="relative cursor-crosshair rounded-md"
            style={{
              width: 192,   // 48 * 4
              height: 192,  // 48 * 4
              background: `
                linear-gradient(to top, #000, rgba(0,0,0,0)),
                linear-gradient(to right, #fff, ${baseColor})
              `,
            }}
          >
            <div style={svMarkerStyle} />
          </div>

          <div
            ref={hRef}
            onMouseDown={startDragH}
            className="relative cursor-pointer rounded-md"
            style={{
              width: 24,    // ~w-6
              height: 192,  // match SV height
              background: "linear-gradient(to bottom,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)",
            }}
          >
            <div style={hMarkerStyle} />
          </div>
        </div>

        {/* Recent */}
        {recent.length > 0 && (
          <>
            <div className="mt-3 text-xs text-gray-500">Recent colors</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {recent.map((c) => (
                <button
                  key={c}
                  className="aspect-square w-8 rounded border border-gray-300"
                  style={{ background: c }}
                  title={c}
                  onClick={() => {
                    // Update internal HSV first so the useEffect emits the same color,
                    // preventing the “revert” from old (h,s,v).
                    setFromHex(c);
                    // (Optional) still inform parent it came from "recent" specifically:
                    onPickRecent(c);
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
