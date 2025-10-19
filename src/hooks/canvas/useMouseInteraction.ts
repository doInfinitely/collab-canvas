// Mouse interaction and drag handling

import { useState, useCallback, useRef } from 'react';
import { 
  shapeCenter, 
  nearCorner, 
  nearPerimeter, 
  pointInShape, 
  pointInTextBox, 
  worldToLocal 
} from '@/lib/canvas/geometry';
import { resolveSides } from '@/lib/canvas/shapes';

type Shape = any; // Will be inferred from parent

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

type UseMouseInteractionProps = {
  userId: string;
  shapes: Map<string, Shape>;
  shapesRef: React.RefObject<Map<string, Shape>>;
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setEditingTextId: (id: string | null) => void;
  setEditingText: (text: string) => void;
  worldFromSvgEvent: (e: React.MouseEvent<SVGSVGElement>) => { wx: number; wy: number };
  scaleRef: React.RefObject<number>;
  shapeOrdered: Shape[];
  createShape: (props: { x: number; y: number; width: number; height: number }) => Promise<Shape>;
  updateShapePosition: (id: string, x: number, y: number) => void;
  updateShapesPositions: (updates: Array<{ id: string; x: number; y: number }>) => void;
  updateShapeSize: (id: string, x: number, y: number, width: number, height: number) => void;
  updateShapeRotation: (id: string, rotation: number) => void;
  deleteShapes: (ids: string[]) => Promise<boolean>;
};

export function useMouseInteraction({
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
}: UseMouseInteractionProps) {
  // Selection helpers
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [setSelectedIds]);
  const addToSelection = useCallback((id: string) =>
    setSelectedIds((prev: Set<string>) => (prev.has(id) ? prev : new Set([...prev, id]))),
    [setSelectedIds]
  );

  // Multi-select drag state
  const multiDragRef = useRef<null | {
    startMouseX: number;
    startMouseY: number;
    starts: Array<{ id: string; x: number; y: number }>;
  }>(null);

  // Marquee selection state
  const [marquee, setMarquee] = useState<null | {
    startX: number; startY: number; curX: number; curY: number;
  }>(null);

  // Double-click tracking
  const dblClickRef = useRef(false);

  // Click tracking for text editing
  const clickStartRef = useRef<{ x: number; y: number; shapeId: string | null } | null>(null);

  // Drag state
  const [drag, setDrag] = useState<DragState>({ kind: "none" });

  // Hit testing
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
    const threshWorld = 10 / scaleRef.current!;
    for (let i = shapeOrdered.length - 1; i >= 0; i--) {
      const s = shapeOrdered[i];
      if (nearPerimeter(s, wx, wy, threshWorld)) return s;
    }
    return null;
  }, [shapeOrdered, worldFromSvgEvent, scaleRef]);

  // Cursor for perimeter interactions
  const cursorForPerimeter = useCallback((s: Shape, wx: number, wy: number, modForRotate: boolean) => {
    if (modForRotate) return "grab" as const;
    const sides = resolveSides(s.sides);
    const threshWorld = 10 / scaleRef.current!;
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
  }, [scaleRef]);

  // Mouse down handler
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
      const threshWorld = 10 / scaleRef.current!;
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
  }, [userId, shapes, selectedIds, pickPerimeter, pickShapeEvt, worldFromSvgEvent, scaleRef, addToSelection, clearSelection]);

  // Mouse move handler
  const onLeftMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const { wx, wy } = worldFromSvgEvent(e);

    if (marquee) { setMarquee(m => (m ? { ...m, curX: wx, curY: wy } : m)); return; }

    if (multiDragRef.current) {
      const dx = (e.clientX - multiDragRef.current.startMouseX) / scaleRef.current!;
      const dy = (e.clientY - multiDragRef.current.startMouseY) / scaleRef.current!;
      const updates = multiDragRef.current.starts.map(({ id, x, y }) => ({
        id,
        x: x + dx,
        y: y + dy,
      }));
      updateShapesPositions(updates);
      return;
    }

    if (drag.kind === "creating") {
      setDrag({ kind: "creating", start: drag.start, ghost: { ...drag.ghost, width: wx - drag.start.x, height: wy - drag.start.y } });
      return;
    }

    if (drag.kind === "moving") {
      const newX = wx - drag.grabOffset.dx;
      const newY = wy - drag.grabOffset.dy;
      updateShapePosition(drag.id, newX, newY);
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

      updateShapeSize(drag.id, nx, ny, newW, newH);
      return;
    }

    if (drag.kind === "rotating") {
      const s0 = shapesRef.current!.get(drag.id);
      if (!s0) return;
      const { cx, cy } = shapeCenter(s0);
      const ang = Math.atan2(wy - cy, wx - cx);
      const newRot = drag.initialRot + (ang - drag.startAngle);
      updateShapeRotation(drag.id, newRot);
      return;
    }
  }, [drag, marquee, worldFromSvgEvent, scaleRef, shapesRef, updateShapesPositions, updateShapePosition, updateShapeSize, updateShapeRotation]);

  // Mouse up handler
  const onLeftUp = useCallback(async (e: React.MouseEvent<SVGSVGElement>) => {
    // Check for text click FIRST (only if it was a click, not a drag)
    if (clickStartRef.current && drag.kind === "moving") {
      const dx = Math.abs(e.clientX - clickStartRef.current.x);
      const dy = Math.abs(e.clientY - clickStartRef.current.y);
      
      // If mouse barely moved, treat as click not drag
      if (dx < 5 && dy < 5 && clickStartRef.current.shapeId) {
        const s = shapesRef.current!.get(clickStartRef.current.shapeId);
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
        await createShape({ x: nx, y: ny, width: nw, height: nh });
      }
      return;
    }

    if (drag.kind === "moving" || drag.kind === "resizing" || drag.kind === "rotating") {
      setDrag({ kind: "none" });
    }
  }, [drag, marquee, shapes, shapesRef, worldFromSvgEvent, setEditingTextId, setEditingText, setSelectedIds, createShape]);

  // Double-click handler (for deletion)
  const onDoubleClickSVG = useCallback(async (e: React.MouseEvent<SVGSVGElement>) => {
    dblClickRef.current = true; // Mark that double-click happened
    
    if (drag.kind !== "none") return;
    const hit = pickShapeEvt(e);
    if (!hit) return;
    const idsToDelete = selectedIds.has(hit.id) ? Array.from(selectedIds) : [hit.id];
    
    const success = await deleteShapes(idsToDelete);
    if (success) {
      setSelectedIds(new Set());
    }
    
    // Clear the flag after a short delay
    setTimeout(() => {
      dblClickRef.current = false;
    }, 300);
  }, [drag, pickShapeEvt, selectedIds, deleteShapes, setSelectedIds]);

  return {
    // State
    drag,
    marquee,
    
    // Functions
    pickShapeEvt,
    pickPerimeter,
    cursorForPerimeter,
    clearSelection,
    addToSelection,
    
    // Handlers
    onLeftDown,
    onLeftMove,
    onLeftUp,
    onDoubleClickSVG,
  };
}

