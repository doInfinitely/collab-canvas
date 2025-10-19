// src/components/CanvasViewport.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import Portal from "@/components/Portal";
import ChatBox from "@/components/ChatBox";

// Utility imports
import { normalizeHex } from "@/lib/canvas/colors";
import { nowIso, resolveSides } from "@/lib/canvas/shapes";
import { pointInShape, nearPerimeter, pointInTextBox } from "@/lib/canvas/geometry";

// Canvas sub-components
import { DebugHUD } from "@/components/canvas/DebugHUD";
import { MultiplayerCursors } from "@/components/canvas/MultiplayerCursors";
import { TextEditorOverlay } from "@/components/canvas/TextEditorOverlay";
import { CanvasContextMenu } from "@/components/canvas/CanvasContextMenu";
import { ShapeRenderer } from "@/components/canvas/ShapeRenderer";
import { ColorPickerPopover } from "@/components/canvas/ColorPickerPopover";
import { ShapePropertiesModal } from "@/components/canvas/ShapePropertiesModal";

// Canvas hooks
import { useColorPicker } from "@/hooks/canvas/useColorPicker";
import { usePresence } from "@/hooks/canvas/usePresence";
import { useAnnotations } from "@/hooks/canvas/useAnnotations";
import { useCanvasVersioning } from "@/hooks/canvas/useCanvasVersioning";
import { useKeyboardShortcuts } from "@/hooks/canvas/useKeyboardShortcuts";
import { usePanZoom } from "@/hooks/canvas/usePanZoom";
import { useAIHelpers } from "@/hooks/canvas/useAIHelpers";
import { useShapeOperations } from "@/hooks/canvas/useShapeOperations";
import { useDataLoading } from "@/hooks/canvas/useDataLoading";
import { useShapeCRUD } from "@/hooks/canvas/useShapeCRUD";
import { useMouseInteraction } from "@/hooks/canvas/useMouseInteraction";
import type { Shape } from "@/types/canvas";

type Props = { userId: string };

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

// getTabId helper for presence tracking
function getTabId() {
  try { return crypto.randomUUID(); }
  catch { return `tab_${Math.random().toString(36).slice(2)}`; }
}

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

  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const textDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Modal state
  const [modalShapeId, setModalShapeId] = useState<string | null>(null);
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
  // Color picker hook
  const {
    picker,
    setPicker,
    recentColors,
    lastColorTarget,
    setLastColorTarget,
    addRecentColor,
  } = useColorPicker();

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


  // helper: TitleCase and concat
  const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
  const toName = (adj: string, noun: string) => `${cap(adj)}${cap(noun)}`;

  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ===== presence =====
  const { profiles, remoteCursors, schedulePublish } = usePresence({
    userId,
    offsetRef,
    scaleRef,
    cursorRef,
    screenCursorRef,
  });

  // ===== annotations =====
  const {
    annotationsByShape,
    annotationInput,
    setAnnotationInput,
    deleteAnnotation,
    loadAnnotationsForShape,
    addAnnotation: addAnnotationHook,
    aiAddAnnotation,
    aiAddAnnotations,
    getAnnotations,
  } = useAnnotations({
    userId,
    shapesRef,
    selectedIdsRef,
    profiles,
  });

  const [svgCursor, setSvgCursor] = useState<"default" | "crosshair" | "ew-resize" | "ns-resize" | "nwse-resize" | "nesw-resize" | "grab">("default");

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

  const [canvasMenuPos, setCanvasMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [showCanvasMenu, setShowCanvasMenu] = useState(false);
  const [canvasMenuTab, setCanvasMenuTab] = useState<'export' | 'versions'>('export');

  // use to force a re-render when we only mutate refs
  const [, forceRender] = useState(0);

  // Mouse movement tracking for cursor position
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


  // ===== AI Helper Functions (now in hooks) =====

  // AI shape operations (moved to useShapeOperations hook)

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

  // ===== data loading hook (loads wordlists and initial shapes) =====
  const { wordlists } = useDataLoading({
    setShapes,
  });

  // ===== shape operations hook (needs to be before shapes channel setup) =====
  const {
    frontZ,
    backZ,
    upsertShapeLocal,
    removeShapeLocal,
    usedNames,
    randomName,
    aiCreateShape,
    aiCreateShapes,
    aiDeleteShapes,
    aiUpdateShapeProperties,
    aiUpdateShapesProperties,
    aiUpdateSelectionProperties,
    aiRenameShape,
  } = useShapeOperations({
    userId,
    shapesRef,
    setShapes,
    shapesChRef,
    wordlists,
    selectedIds,
    setSelectedIds,
  });

  // ===== shape CRUD hook =====
  const {
    createShape,
    deleteShapes,
    updateShapePosition,
    updateShapesPositions,
    updateShapeSize,
    updateShapeRotation,
    updateShapeText,
    schedulePersist,
  } = useShapeCRUD({
    userId,
    shapesRef,
    setShapes,
    shapesChRef,
    upsertShapeLocal,
    removeShapeLocal,
    frontZ,
    randomName,
    wordlists,
  });

  // ===== mouse interaction hook =====
  const {
    drag,
    marquee,
    pickShapeEvt,
    pickPerimeter,
    cursorForPerimeter,
    clearSelection,
    addToSelection,
    onLeftDown,
    onLeftMove,
    onLeftUp,
    onDoubleClickSVG,
  } = useMouseInteraction({
    userId,
    shapes,
    shapesRef,
    selectedIds,
    setSelectedIds,
    setEditingTextId,
    setEditingText,
    worldFromSvgEvent,
    scaleRef,
    shapeOrdered,
    createShape,
    updateShapePosition,
    updateShapesPositions,
    updateShapeSize,
    updateShapeRotation,
    deleteShapes,
  });

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

  // ===== canvas versioning & export (after shapesChRef is ready) =====
  const {
    canvasVersions,
    exportAsSVG,
    exportAsPNG,
    exportAsJSON,
    saveCanvasVersion,
    restoreCanvasVersion,
    encodeCanvasToJSON,
  } = useCanvasVersioning({
    userId,
    shapesRef,
    offsetRef,
    scaleRef,
    svgRef,
    shapeOrdered,
    setShapes,
    shapesChRef,
  });

  // Wrapper to close menu after restore
  const restoreCanvasVersionAndClose = useCallback(async (versionId: string) => {
    const success = await restoreCanvasVersion(versionId);
    if (success) {
      setShowCanvasMenu(false);
    }
    return success;
  }, [restoreCanvasVersion]);

  // AI: Get UI state (modals, HUD, versions) - needs canvasVersions from hook
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

  // ===== keyboard shortcuts hook =====
  useKeyboardShortcuts({
    userId,
    shapesRef,
    selectedIdsRef,
    offsetRef,
    scaleRef,
    screenCursorRef,
    shapesChRef,
    setShapes,
    setSelectedIds,
    setShowDebug,
    setShowCanvasMenu,
  });

  // ===== pan/zoom hook =====
  const {
    panToCoordinate,
    aiSetZoom,
    aiGetViewport,
    aiSetPan,
  } = usePanZoom({
    containerRef,
    svgRef,
    offsetRef,
    scaleRef,
    setOffset,
    setScale,
    offset,
    scale,
    schedulePublish,
  });

  // ===== AI helpers hook =====
  const {
    getSelectedShapeIds,
    getUserCursors,
    aiAddToSelection,
    aiRemoveFromSelection,
    aiClearSelection,
    aiToggleShapeModal,
    aiToggleDebugHUD,
    aiToggleCanvasMenu,
  } = useAIHelpers({
    shapesRef,
    selectedIds,
    setSelectedIds,
    modalShapeId,
    setModalShapeId,
    showDebug,
    setShowDebug,
    showCanvasMenu,
    setShowCanvasMenu,
    setCanvasMenuTab,
    remoteCursors,
    profiles,
  });

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

  const keyboardRestoreVersion = useCallback(async (versionToRestore: { id: string }) => {
    const result = await restoreCanvasVersionAndClose(versionToRestore.id);
    return { success: result };
  }, [restoreCanvasVersionAndClose]);

  // Auto-name shapes that don't have names (after wordlists load)
  useEffect(() => {
    if (!wordlists) return;
    
    // Find nameless shapes
    const nameless = Array.from(shapesRef.current.values()).filter(s => !s.name);
    if (nameless.length === 0) return;

    const updates: Array<{ id: string; name: string }> = [];
    for (const s of nameless) {
      const name = randomName(wordlists.adjs, wordlists.nouns);
      updates.push({ id: s.id, name });
    }

    if (updates.length === 0) return;

    // Optimistic local update
    setShapes(prev => {
      const m = new Map(prev);
      const now = nowIso();
      for (const u of updates) {
        const cur = m.get(u.id);
        if (!cur) continue;
        m.set(u.id, { ...cur, name: u.name, updated_at: now });
      }
      return m;
    });

    // Broadcast each update
    for (const u of updates) {
      shapesChRef.current?.send({ 
        type: "broadcast", 
        event: "shape-name", 
        payload: { id: u.id, name: u.name, updated_at: nowIso() } 
      });
    }

    // Persist to database (batched update)
    (async () => {
      try {
        for (const u of updates) {
          await supabase
            .from("shapes")
            .update({ name: u.name, updated_at: nowIso() })
            .eq("id", u.id);
        }
      } catch (e) {
        console.warn("Backfill names failed:", e);
      }
    })();
  }, [wordlists, shapesRef, shapesChRef, setShapes, randomName]);

  // ===== COPY / CUT / PASTE =====
  const handleTextChange = useCallback((text: string) => {
    setEditingText(text);
    
    if (textDebounceRef.current) clearTimeout(textDebounceRef.current);
    
    textDebounceRef.current = setTimeout(() => {
      if (!editingTextId) return;
      updateShapeText(editingTextId, text);
    }, 250);
  }, [editingTextId, updateShapeText]);

  const handleTextBlur = useCallback(() => {
    if (textDebounceRef.current) {
      clearTimeout(textDebounceRef.current);
      textDebounceRef.current = null;
    }
    setEditingTextId(null);
  }, []);

  // ===== Annotations (using hook) =====
  const openModalForShape = useCallback(async (shapeId: string) => {
    setModalShapeId(shapeId);
    setAnnotationInput("");

    const s = shapesRef.current.get(shapeId);
    setSidesInput(String(resolveSides(s?.sides)));

    // Initialize style inputs
    setStrokeWidthInput(String(s?.stroke_width ?? 2));
    setStrokeColorInput(String(s?.stroke ?? "#000000"));
    setTextColorInput(String(s?.text_color ?? "#000000"));
    if (s?.fill == null) {
      setNoFill(true);
      setFillColorInput("#ffffff");
    } else {
      setNoFill(false);
      setFillColorInput(String(s.fill));
    }
    setLastColorTarget("stroke");

    // Load annotations for this shape
    await loadAnnotationsForShape(shapeId);
  }, [loadAnnotationsForShape, setAnnotationInput, setLastColorTarget]);

  const closeModal = useCallback(() => { setModalShapeId(null); setAnnotationInput(""); setPicker(null); }, [setAnnotationInput]);

  // Wrapper for addAnnotation that passes modalShapeId
  const addAnnotation = useCallback(() => addAnnotationHook(modalShapeId), [addAnnotationHook, modalShapeId]);

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
    window.addEventListener('mousedown', close);
    return () => {
      window.removeEventListener('mousedown', close);
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
          {shapeOrdered.map((s) => (
            <ShapeRenderer
              key={s.id}
              shape={s}
              scale={scale}
              isSelected={selectedIds.has(s.id)}
              isEditing={editingTextId === s.id}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openModalForShape(s.id); }}
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
      <TextEditorOverlay
        shapes={shapeOrdered}
        editingTextId={editingTextId}
        editingText={editingText}
        offset={offset}
        scale={scale}
        onTextChange={handleTextChange}
        onTextBlur={handleTextBlur}
      />
      {/* Multiplayer cursors */}
      <MultiplayerCursors remoteCursors={remoteCursors} offset={offsetRef.current} profiles={profiles} />

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
        const ownerEmail = profiles.get(s.created_by) ?? s.created_by;
        const anns = annotationsByShape.get(modalShapeId) ?? [];
        return (
          <ShapePropertiesModal
            shape={s}
            userEmail={email}
            ownerEmail={ownerEmail}
            annotations={anns}
            profiles={profiles}
            userId={userId}
            selectedIds={selectedIds}
            
            sidesInput={sidesInput}
            zIndexInput={zIndexInput}
            strokeWidthInput={strokeWidthInput}
            strokeColorInput={strokeColorInput}
            fillColorInput={fillColorInput}
            textColorInput={textColorInput}
            noFill={noFill}
            annotationInput={annotationInput}
            lastColorTarget={lastColorTarget}
            recentColors={recentColors}
            
            setSidesInput={setSidesInput}
            setZIndexInput={setZIndexInput}
            setStrokeWidthInput={setStrokeWidthInput}
            setStrokeColorInput={setStrokeColorInput}
            setFillColorInput={setFillColorInput}
            setTextColorInput={setTextColorInput}
            setNoFill={setNoFill}
            setAnnotationInput={setAnnotationInput}
            setLastColorTarget={setLastColorTarget}
            
            onClose={closeModal}
            onSaveSides={saveSides}
            onSaveZIndex={saveZIndex}
            onSaveStyle={saveStyle}
            onSendToFront={sendToFront}
            onSendToBack={sendToBack}
            onAddAnnotation={addAnnotation}
            onDeleteAnnotation={deleteAnnotation}
            onOpenColorPicker={(target, x, y, initial) => {
              setPicker({ for: target, x, y, initial });
            }}
          />
        );
      })()}
      {/* Canvas Context Menu */}
      <CanvasContextMenu
        show={showCanvasMenu}
        position={canvasMenuPos}
        menuRef={menuRef}
        activeTab={canvasMenuTab}
        versions={canvasVersions}
        onTabChange={setCanvasMenuTab}
        onClose={() => setShowCanvasMenu(false)}
        onExportPNG={exportAsPNG}
        onExportSVG={exportAsSVG}
        onExportJSON={exportAsJSON}
        onSaveVersion={saveCanvasVersion}
        onRestoreVersion={(versionId) => void restoreCanvasVersionAndClose(versionId)}
      />
      {/* Debug HUD */}
      <DebugHUD visible={showDebug} offset={offset} scale={scale} cursor={cursor} />
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
          getAnnotations={getAnnotations}
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
