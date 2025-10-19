// Keyboard shortcut handlers for canvas

import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { nowIso } from '@/lib/canvas/shapes';

type Shape = any; // Will be inferred from parent

type UseKeyboardShortcutsProps = {
  userId: string;
  shapesRef: React.RefObject<Map<string, Shape>>;
  selectedIdsRef: React.RefObject<Set<string>>;
  offsetRef: React.RefObject<{ x: number; y: number }>;
  scaleRef: React.RefObject<number>;
  screenCursorRef: React.RefObject<{ x: number; y: number }>;
  shapesChRef: React.RefObject<any>;
  setShapes: (fn: (prev: Map<string, Shape>) => Map<string, Shape>) => void;
  setSelectedIds: (fn: (prev: Set<string>) => Set<string>) => void;
  setShowDebug: (fn: (prev: boolean) => boolean) => void;
  setShowCanvasMenu: (value: boolean) => void;
};

export function useKeyboardShortcuts({
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
}: UseKeyboardShortcutsProps) {
  const clipboardRef = useRef<Shape[] | null>(null);

  // Helper: Get world coordinates of cursor
  const worldCursor = useCallback(() => ({
    x: offsetRef.current!.x + screenCursorRef.current!.x / scaleRef.current!,
    y: offsetRef.current!.y + screenCursorRef.current!.y / scaleRef.current!,
  }), [offsetRef, scaleRef, screenCursorRef]);

  // Helper: Calculate bounding box of shapes
  const bboxOf = useCallback((items: Shape[]) => {
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
  }, []);

  // Copy selected shapes to clipboard
  const doCopy = useCallback(() => {
    const ids = Array.from(selectedIdsRef.current!);
    if (ids.length === 0) return;
    const shapesToCopy = ids.map((id) => shapesRef.current!.get(id)).filter(Boolean) as Shape[];
    clipboardRef.current = shapesToCopy.map(s => ({ ...s }));
  }, [selectedIdsRef, shapesRef]);

  // Cut selected shapes (copy + delete)
  const doCut = useCallback(async () => {
    const ids = Array.from(selectedIdsRef.current!);
    if (ids.length === 0) return;
    const shapesToCut = ids.map((id) => shapesRef.current!.get(id)).filter(Boolean) as Shape[];
    clipboardRef.current = shapesToCut.map(s => ({ ...s }));
    setShapes(prev => { const m = new Map(prev); for (const id of ids) m.delete(id); return m; });
    for (const id of ids) shapesChRef.current?.send({ type: "broadcast", event: "shape-delete", payload: { id } });
    const { error } = await supabase.from("shapes").delete().in("id", ids);
    if (error) {
      console.warn("Cut delete failed:", error.message);
      setShapes(prev => { const m = new Map(prev); for (const s of shapesToCut) m.set(s.id, s); return m; });
    }
    setSelectedIds(() => new Set());
  }, [selectedIdsRef, shapesRef, setShapes, shapesChRef, setSelectedIds]);

  // Paste clipboard shapes at cursor
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
      setShapes(prev => { const m = new Map(prev); for (const id of newShapes.map(s => s.id)) m.delete(id); return m; });
    } else {
      setSelectedIds(() => new Set(newShapes.map(s => s.id)));
    }
  }, [userId, worldCursor, bboxOf, setShapes, shapesChRef, setSelectedIds]);

  // Main keyboard event listener
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
  }, [doCopy, doCut, doPaste, setShowDebug]);

  // Escape key handler for canvas menu
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowCanvasMenu(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [setShowCanvasMenu]);

  return {
    doCopy,
    doCut,
    doPaste,
  };
}

