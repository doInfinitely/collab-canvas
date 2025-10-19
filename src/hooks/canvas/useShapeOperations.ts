// AI shape manipulation operations (create, update, delete)

import { useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { nowIso } from '@/lib/canvas/shapes';
import type { Shape, Wordlists } from '@/types/canvas';

type UseShapeOperationsProps = {
  userId: string;
  shapesRef: React.RefObject<Map<string, Shape>>;
  setShapes: (value: Map<string, Shape> | ((prev: Map<string, Shape>) => Map<string, Shape>)) => void;
  shapesChRef: React.RefObject<ReturnType<typeof supabase.channel> | null>;
  wordlists: Wordlists | null;
  selectedIds: Set<string>;
  setSelectedIds: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
};

export function useShapeOperations({
  userId,
  shapesRef,
  setShapes,
  shapesChRef,
  wordlists,
  selectedIds,
  setSelectedIds,
}: UseShapeOperationsProps) {

  // Helper: Get used shape names
  const usedNames = useCallback(() => {
    const set = new Set<string>();
    for (const s of shapesRef.current!.values()) {
      if (s.name) set.add(s.name.toLowerCase());
    }
    return set;
  }, [shapesRef]);

  // Helper: Generate random unique name
  const randomName = useCallback((adjs: string[], nouns: string[]): string => {
    const taken = usedNames();
    let seed = Date.now() ^ Math.floor(Math.random() * 0x9e3779b1);
    const lcg = () => (seed = (seed * 1664525 + 1013904223) >>> 0);

    const maxTries = 5000;
    for (let i = 0; i < maxTries; i++) {
      const adj = adjs[lcg() % adjs.length];
      const noun = nouns[lcg() % nouns.length];
      const candidate = adj + noun;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return adjs[lcg() % adjs.length] + nouns[lcg() % nouns.length] + (lcg() % 100);
  }, [usedNames]);

  // Helper: Get highest z-index
  const frontZ = useCallback(() => {
    const values = Array.from(shapesRef.current!.values());
    const maxZ = values.length ? Math.max(...values.map(s => s.z ?? 0)) : 0;
    return Math.floor(maxZ) + 1;
  }, [shapesRef]);

  // Helper: Get lowest z-index
  const backZ = useCallback(() => {
    const values = Array.from(shapesRef.current!.values());
    const minZ = values.length ? Math.min(...values.map(s => s.z ?? 0)) : 0;
    return Math.ceil(minZ) - 1;
  }, [shapesRef]);

  // Helper: Upsert shape locally
  const upsertShapeLocal = useCallback((s: Shape) => {
    setShapes(prev => {
      const m = new Map(prev);
      m.set(s.id, s);
      return m;
    });
  }, [setShapes]);
  
  // Helper: Remove shape locally
  const removeShapeLocal = useCallback((id: string) => {
    setShapes(prev => {
      const m = new Map(prev);
      m.delete(id);
      return m;
    });
  }, [setShapes]);

  // AI: Update single shape properties
  const aiUpdateShapeProperties = useCallback(async (shapeId: string, updates: Partial<Shape>) => {
    console.log('AI: Updating shape', shapeId, 'with updates:', updates);
    
    const shape = shapesRef.current!.get(shapeId);
    if (!shape) {
      console.error('AI: Shape not found:', shapeId);
      return { success: false, error: 'Shape not found' };
    }

    // Round numeric values
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
  }, [shapesRef, setShapes, shapesChRef]);

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
  }, [wordlists, usedNames, aiUpdateShapeProperties]);

  // AI: Update properties for multiple shapes
  const aiUpdateShapesProperties = useCallback(async (shapeIds: string[], updates: Partial<Shape>) => {
    console.log('AI: updateShapesProperties called with', shapeIds.length, 'shape IDs');
    
    const validIds = shapeIds.filter(id => shapesRef.current!.has(id));
    console.log('AI: Found', validIds.length, 'valid IDs out of', shapeIds.length);
    
    if (validIds.length === 0) {
      console.error('AI: No valid shapes found');
      return { success: false, error: `No valid shapes found. Received ${shapeIds.length} IDs but none exist.` };
    }

    // Round numeric values
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
  }, [shapesRef, setShapes, shapesChRef]);

  // AI: Update properties for current selection
  const aiUpdateSelectionProperties = useCallback(async (updates: Partial<Shape>) => {
    const selectedIdsArray = Array.from(selectedIds);
    if (selectedIdsArray.length === 0) {
      return { success: false, error: 'No shapes selected' };
    }

    // Round numeric values
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
  }, [selectedIds, setShapes, shapesChRef]);

  // AI: Create single shape
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
  }, [wordlists, userId, randomName, frontZ, upsertShapeLocal, removeShapeLocal, shapesChRef]);

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
    const usedNamesSet = new Set<string>();

    // Generate all shapes
    for (const params of shapesList) {
      let name = randomName(wordlists.adjs, wordlists.nouns);
      // Ensure unique names
      while (usedNamesSet.has(name)) {
        name = randomName(wordlists.adjs, wordlists.nouns);
      }
      usedNamesSet.add(name);

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
  }, [wordlists, userId, randomName, frontZ, upsertShapeLocal, removeShapeLocal, shapesChRef]);

  // AI: Delete shapes
  const aiDeleteShapes = useCallback(async (shapeIds: string[]) => {
    const validIds = shapeIds.filter(id => shapesRef.current!.has(id));
    if (validIds.length === 0) {
      return { success: false, error: 'No valid shapes found' };
    }

    const toRestore = validIds.map(id => shapesRef.current!.get(id)).filter(Boolean) as Shape[];
    
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
  }, [shapesRef, setShapes, shapesChRef, setSelectedIds]);

  return {
    // Helpers
    frontZ,
    backZ,
    upsertShapeLocal,
    removeShapeLocal,
    usedNames,
    randomName,
    // AI Operations
    aiCreateShape,
    aiCreateShapes,
    aiDeleteShapes,
    aiUpdateShapeProperties,
    aiUpdateShapesProperties,
    aiUpdateSelectionProperties,
    aiRenameShape,
  };
}

