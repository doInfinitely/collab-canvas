// AI helper functions for canvas interaction

import { useCallback } from 'react';

type Shape = any; // Will be inferred from parent

type UseAIHelpersProps = {
  shapesRef: React.RefObject<Map<string, Shape>>;
  selectedIds: Set<string>;
  setSelectedIds: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  modalShapeId: string | null;
  setModalShapeId: (value: string | null) => void;
  showDebug: boolean;
  setShowDebug: (value: boolean | ((prev: boolean) => boolean)) => void;
  showCanvasMenu: boolean;
  setShowCanvasMenu: (value: boolean | ((prev: boolean) => boolean)) => void;
  setCanvasMenuTab: (value: 'export' | 'versions') => void;
  remoteCursors: Map<string, any>;
  profiles: Map<string, string>;
};

export function useAIHelpers({
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
}: UseAIHelpersProps) {

  // Get selected shape IDs
  const getSelectedShapeIds = useCallback(() => {
    return Array.from(selectedIds);
  }, [selectedIds]);

  // Get remote user cursors with profile info
  const getUserCursors = useCallback(() => {
    return Array.from(remoteCursors.entries()).map(([uid, cursor]) => ({
      userId: uid,
      email: profiles.get(uid) ?? uid,
      worldX: cursor.worldX,
      worldY: cursor.worldY,
    }));
  }, [remoteCursors, profiles]);

  // AI: Add shapes to selection
  const aiAddToSelection = useCallback((shapeIds: string[]) => {
    const validIds = shapeIds.filter(id => shapesRef.current!.has(id));
    if (validIds.length === 0) {
      return { success: false, error: 'No valid shapes found' };
    }

    setSelectedIds(prev => {
      const newSet = new Set(prev);
      validIds.forEach(id => newSet.add(id));
      return newSet;
    });

    return { success: true, added: validIds.length };
  }, [shapesRef, setSelectedIds]);

  // AI: Remove shapes from selection
  const aiRemoveFromSelection = useCallback((shapeIds: string[]) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      shapeIds.forEach(id => newSet.delete(id));
      return newSet;
    });

    return { success: true, removed: shapeIds.length };
  }, [setSelectedIds]);

  // AI: Clear selection
  const aiClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    return { success: true };
  }, [setSelectedIds]);

  // AI: Toggle shape properties modal
  const aiToggleShapeModal = useCallback((action: 'open' | 'close' | 'toggle', shapeId?: string) => {
    if (action === 'close') {
      setModalShapeId(null);
      return { success: true, isOpen: false };
    }
    
    if (action === 'toggle') {
      if (modalShapeId) {
        setModalShapeId(null);
        return { success: true, isOpen: false };
      } else if (shapeId && shapesRef.current!.has(shapeId)) {
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
      if (!shapesRef.current!.has(shapeId)) {
        return { success: false, error: 'Shape not found' };
      }
      setModalShapeId(shapeId);
      return { success: true, isOpen: true, shapeId };
    }

    return { success: false, error: 'Invalid action' };
  }, [modalShapeId, setModalShapeId, shapesRef]);

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
  }, [showDebug, setShowDebug]);

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
  }, [showCanvasMenu, setShowCanvasMenu, setCanvasMenuTab]);

  return {
    getSelectedShapeIds,
    getUserCursors,
    aiAddToSelection,
    aiRemoveFromSelection,
    aiClearSelection,
    aiToggleShapeModal,
    aiToggleDebugHUD,
    aiToggleCanvasMenu,
  };
}

