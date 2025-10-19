// Shape annotations management with real-time sync

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { nowIso } from '@/lib/canvas/shapes';

type Annotation = {
  id: string;
  shape_id: string;
  user_id: string;
  text: string;
  created_at: string;
};

type ShapeAnnotationInsert = Pick<Annotation, "id" | "shape_id" | "user_id" | "text" | "created_at">;

type UseAnnotationsProps = {
  userId: string;
  shapesRef: React.RefObject<Map<string, any>>;
  selectedIdsRef: React.RefObject<Set<string>>;
  profiles: Map<string, string>;
};

export function useAnnotations({
  userId,
  shapesRef,
  selectedIdsRef,
  profiles,
}: UseAnnotationsProps) {
  const [annotationsByShape, setAnnotationsByShape] = useState<Map<string, Annotation[]>>(new Map());
  const [annotationInput, setAnnotationInput] = useState("");
  const annotationsChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Set up real-time channel for annotation sync
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

  // Delete an annotation
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
      // reload this shape's annotations from DB as fallback
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

  // Load annotations for a specific shape
  const loadAnnotationsForShape = useCallback(async (shapeId: string) => {
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

  // Add annotation to shape(s)
  const addAnnotation = useCallback(async (modalShapeId: string | null) => {
    const text = annotationInput.trim();
    if (!text || !modalShapeId) return;

    const targetIds = (selectedIdsRef.current!.size > 0 && selectedIdsRef.current!.has(modalShapeId))
      ? Array.from(selectedIdsRef.current!)
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
  }, [annotationInput, userId, selectedIdsRef]);

  // AI: Add annotation to a single shape
  const aiAddAnnotation = useCallback(async (shapeId: string, text: string) => {
    const shape = shapesRef.current!.get(shapeId);
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
  }, [userId, shapesRef]);

  // AI: Add annotations to multiple shapes
  const aiAddAnnotations = useCallback(async (annotations: Array<{ shapeId: string; text: string }>) => {
    const validAnnotations = annotations.filter(({ shapeId }) => shapesRef.current!.has(shapeId));
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
  }, [userId, shapesRef]);

  // AI: Get annotations with optional filters
  const getAnnotations = useCallback((filters?: {
    shapeId?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    let allAnnotations: (Annotation & { shape_name?: string })[] = [];
    
    for (const [shapeId, annotations] of annotationsByShape.entries()) {
      const shape = shapesRef.current!.get(shapeId);
      for (const ann of annotations) {
        allAnnotations.push({
          ...ann,
          shape_name: shape?.name,
        });
      }
    }

    // Apply filters
    if (filters?.shapeId) {
      allAnnotations = allAnnotations.filter(a => a.shape_id === filters.shapeId);
    }
    if (filters?.userId) {
      allAnnotations = allAnnotations.filter(a => a.user_id === filters.userId);
    }
    if (filters?.startDate) {
      const start = new Date(filters.startDate).getTime();
      allAnnotations = allAnnotations.filter(a => new Date(a.created_at).getTime() >= start);
    }
    if (filters?.endDate) {
      const end = new Date(filters.endDate).getTime();
      allAnnotations = allAnnotations.filter(a => new Date(a.created_at).getTime() <= end);
    }

    // Add user email if available
    return allAnnotations.map(ann => ({
      ...ann,
      user_email: profiles.get(ann.user_id) || ann.user_id,
    }));
  }, [annotationsByShape, profiles, shapesRef]);

  return {
    annotationsByShape,
    annotationInput,
    setAnnotationInput,
    deleteAnnotation,
    loadAnnotationsForShape,
    addAnnotation,
    aiAddAnnotation,
    aiAddAnnotations,
    getAnnotations,
  };
}

