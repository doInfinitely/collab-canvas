// Shape CRUD operations: Create, Read, Update, Delete

import { useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { nowIso } from '@/lib/canvas/shapes';
import type { Shape, Wordlists } from '@/types/canvas';

type UseShapeCRUDProps = {
  userId: string;
  shapesRef: React.RefObject<Map<string, Shape>>;
  setShapes: (value: Map<string, Shape> | ((prev: Map<string, Shape>) => Map<string, Shape>)) => void;
  shapesChRef: React.RefObject<ReturnType<typeof supabase.channel> | null>;
  upsertShapeLocal: (shape: Shape) => void;
  removeShapeLocal: (id: string) => void;
  frontZ: () => number;
  randomName: (adjs: string[], nouns: string[]) => string;
  wordlists: Wordlists | null;
};

export function useShapeCRUD({
  userId,
  shapesRef,
  setShapes,
  shapesChRef,
  upsertShapeLocal,
  removeShapeLocal,
  frontZ,
  randomName,
  wordlists,
}: UseShapeCRUDProps) {
  // RAF-based DB update scheduling (prevents too many updates during drag)
  const moveRAF = useRef<number | null>(null);
  const schedulePersist = useCallback((fn: () => void) => {
    if (moveRAF.current != null) return;
    moveRAF.current = requestAnimationFrame(() => {
      moveRAF.current = null;
      fn();
    });
  }, []);

  // Create a new shape
  const createShape = useCallback(async (props: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    const { x, y, width, height } = props;
    const id = (typeof crypto !== "undefined" && "randomUUID" in crypto) 
      ? crypto.randomUUID() 
      : `shape_${Math.random().toString(36).slice(2)}`;
    const name = wordlists ? randomName(wordlists.adjs, wordlists.nouns) : undefined;
    
    const shape: Shape = {
      id,
      created_by: userId,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
      stroke: "#000000",
      stroke_width: 2,
      fill: "#ffffff",
      updated_at: nowIso(),
      sides: 4,
      rotation: 0,
      z: frontZ(),
      name,
      text_color: "#000000",
    };
    
    // Optimistic update
    upsertShapeLocal(shape);
    
    // Broadcast to other clients
    shapesChRef.current?.send({ 
      type: "broadcast", 
      event: "shape-create", 
      payload: shape 
    });
    
    // Persist to database
    const { error } = await supabase.from("shapes").insert(shape);
    if (error) {
      console.warn("DB insert failed, rolling back local:", error);
      removeShapeLocal(id);
    }
    
    return shape;
  }, [userId, wordlists, randomName, frontZ, upsertShapeLocal, removeShapeLocal, shapesChRef]);

  // Delete one or more shapes
  const deleteShapes = useCallback(async (idsToDelete: string[]) => {
    // Save for rollback
    const toRestore = idsToDelete
      .map((id) => shapesRef.current!.get(id))
      .filter(Boolean) as Shape[];
    
    // Optimistic delete
    setShapes(prev => {
      const m = new Map(prev);
      for (const id of idsToDelete) m.delete(id);
      return m;
    });
    
    // Broadcast to other clients
    for (const id of idsToDelete) {
      shapesChRef.current?.send({ 
        type: "broadcast", 
        event: "shape-delete", 
        payload: { id } 
      });
    }
    
    // Persist to database
    const { error } = await supabase.from("shapes").delete().in("id", idsToDelete);
    if (error) {
      console.warn("Batch delete failed:", error.message);
      // Rollback
      setShapes(prev => {
        const m = new Map(prev);
        for (const s of toRestore) m.set(s.id, s);
        return m;
      });
      return false;
    }
    
    return true;
  }, [shapesRef, setShapes, shapesChRef]);

  // Update shape position (used during drag)
  const updateShapePosition = useCallback((id: string, x: number, y: number) => {
    const nx = Math.round(x);
    const ny = Math.round(y);
    
    // Optimistic update
    setShapes(prev => {
      const m = new Map(prev);
      const s = m.get(id);
      if (!s) return prev;
      m.set(id, { ...s, x: nx, y: ny, updated_at: nowIso() });
      return m;
    });
    
    // Broadcast
    shapesChRef.current?.send({ 
      type: "broadcast", 
      event: "shape-move", 
      payload: { id, x: nx, y: ny, updated_at: nowIso() } 
    });
    
    // Persist (scheduled)
    schedulePersist(async () => {
      await supabase.from("shapes")
        .update({ x: nx, y: ny, updated_at: nowIso() })
        .eq("id", id);
    });
  }, [setShapes, shapesChRef, schedulePersist]);

  // Update multiple shapes' positions (used during multi-drag)
  const updateShapesPositions = useCallback((updates: Array<{ id: string; x: number; y: number }>) => {
    // Optimistic update
    setShapes(prev => {
      const m = new Map(prev);
      for (const { id, x, y } of updates) {
        const s = m.get(id);
        if (!s) continue;
        m.set(id, { ...s, x: Math.round(x), y: Math.round(y), updated_at: nowIso() });
      }
      return m;
    });
    
    // Broadcast and persist each
    for (const { id, x, y } of updates) {
      const nx = Math.round(x);
      const ny = Math.round(y);
      
      shapesChRef.current?.send({ 
        type: "broadcast", 
        event: "shape-move", 
        payload: { id, x: nx, y: ny, updated_at: nowIso() } 
      });
      
      schedulePersist(async () => {
        await supabase.from("shapes")
          .update({ x: nx, y: ny, updated_at: nowIso() })
          .eq("id", id);
      });
    }
  }, [setShapes, shapesChRef, schedulePersist]);

  // Update shape size (used during resize)
  const updateShapeSize = useCallback((
    id: string, 
    x: number, 
    y: number, 
    width: number, 
    height: number
  ) => {
    const nx = Math.round(x);
    const ny = Math.round(y);
    const nw = Math.round(width);
    const nh = Math.round(height);
    
    // Optimistic update
    setShapes(prev => {
      const m = new Map(prev);
      const cur = m.get(id);
      if (!cur) return prev;
      m.set(id, { ...cur, x: nx, y: ny, width: nw, height: nh, updated_at: nowIso() });
      return m;
    });
    
    // Broadcast
    shapesChRef.current?.send({
      type: "broadcast",
      event: "shape-resize",
      payload: { id, x: nx, y: ny, width: nw, height: nh, updated_at: nowIso() },
    });
    
    // Persist (scheduled)
    schedulePersist(async () => {
      await supabase.from("shapes")
        .update({ x: nx, y: ny, width: nw, height: nh, updated_at: nowIso() })
        .eq("id", id);
    });
  }, [setShapes, shapesChRef, schedulePersist]);

  // Update shape rotation (used during rotate)
  const updateShapeRotation = useCallback((id: string, rotation: number) => {
    // Optimistic update
    setShapes(prev => {
      const m = new Map(prev);
      const cur = m.get(id);
      if (!cur) return prev;
      m.set(id, { ...cur, rotation, updated_at: nowIso() });
      return m;
    });
    
    // Broadcast
    shapesChRef.current?.send({ 
      type: "broadcast", 
      event: "shape-rotate", 
      payload: { id, rotation, updated_at: nowIso() } 
    });
    
    // Persist (scheduled)
    schedulePersist(async () => {
      await supabase.from("shapes")
        .update({ rotation, updated_at: nowIso() })
        .eq("id", id);
    });
  }, [setShapes, shapesChRef, schedulePersist]);

  // Update shape text (used from text editor)
  const updateShapeText = useCallback((id: string, text_md: string) => {
    const now = nowIso();
    
    // Optimistic update
    setShapes(prev => {
      const m = new Map(prev);
      const s = m.get(id);
      if (!s) return prev;
      m.set(id, { ...s, text_md, updated_at: now });
      return m;
    });
    
    // Broadcast
    shapesChRef.current?.send({ 
      type: "broadcast", 
      event: "shape-text", 
      payload: { id, text_md, updated_at: now } 
    });
    
    // Persist to database
    supabase.from("shapes")
      .update({ text_md, updated_at: now })
      .eq("id", id)
      .then(({ error }) => {
        if (error) console.warn("Text update failed:", error);
      });
  }, [setShapes, shapesChRef]);

  return {
    createShape,
    deleteShapes,
    updateShapePosition,
    updateShapesPositions,
    updateShapeSize,
    updateShapeRotation,
    updateShapeText,
    schedulePersist,
  };
}

