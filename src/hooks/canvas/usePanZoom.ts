// Pan and zoom functionality for canvas viewport

import { useCallback, useEffect, useRef } from 'react';

type UsePanZoomProps = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  svgRef: React.RefObject<SVGSVGElement | null>;
  offsetRef: React.RefObject<{ x: number; y: number }>;
  scaleRef: React.RefObject<number>;
  setOffset: (value: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => void;
  setScale: (value: number) => void;
  offset: { x: number; y: number };
  scale: number;
  schedulePublish: () => void;
};

export function usePanZoom({
  containerRef,
  svgRef,
  offsetRef,
  scaleRef,
  setOffset,
  setScale,
  offset,
  scale,
  schedulePublish,
}: UsePanZoomProps) {
  
  // Mouse wheel handler for zoom and pan
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom with Ctrl/Cmd + wheel
      const zoomIntensity = 0.0015;
      const old = scaleRef.current!;
      const next = Math.min(4, Math.max(0.2, old * Math.exp(-e.deltaY * zoomIntensity)));
      const cx = e.clientX, cy = e.clientY;
      const worldX = offsetRef.current!.x + cx / old;
      const worldY = offsetRef.current!.y + cy / old;
      setScale(next);
      setOffset({ x: worldX - cx / next, y: worldY - cy / next });
    } else {
      // Pan with wheel
      setOffset((o) => ({
        x: o.x + e.deltaX / scaleRef.current!,
        y: o.y + e.deltaY / scaleRef.current!,
      }));
    }
    schedulePublish();
  }, [offsetRef, scaleRef, setScale, setOffset, schedulePublish]);

  // Attach wheel event listener with passive: false to allow preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, [containerRef, onWheel]);

  // Animated pan to specific coordinate
  const panToCoordinate = useCallback((targetX: number, targetY: number) => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const viewportCenterX = rect.width / 2;
    const viewportCenterY = rect.height / 2;

    // Current center in world coordinates
    const currentCenterX = offsetRef.current!.x + viewportCenterX / scaleRef.current!;
    const currentCenterY = offsetRef.current!.y + viewportCenterY / scaleRef.current!;

    // Calculate distance
    const dx = targetX - currentCenterX;
    const dy = targetY - currentCenterY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Target offset to center on the coordinate
    const targetOffsetX = targetX - viewportCenterX / scaleRef.current!;
    const targetOffsetY = targetY - viewportCenterY / scaleRef.current!;

    // If distance is large (> 2000px), instant jump
    if (distance > 2000) {
      setOffset({ x: targetOffsetX, y: targetOffsetY });
      schedulePublish();
      return;
    }

    // Otherwise, smooth animation
    const startOffset = { ...offsetRef.current! };
    const startTime = Date.now();
    const duration = Math.min(1000, Math.max(300, distance * 0.5)); // 300ms-1000ms based on distance

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease-in-out
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      const currentOffsetX = startOffset.x + (targetOffsetX - startOffset.x) * eased;
      const currentOffsetY = startOffset.y + (targetOffsetY - startOffset.y) * eased;

      setOffset({ x: currentOffsetX, y: currentOffsetY });

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        schedulePublish();
      }
    };

    requestAnimationFrame(animate);
  }, [svgRef, offsetRef, scaleRef, setOffset, schedulePublish]);

  // AI: Set zoom level (optionally with focus point)
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
  }, [svgRef, setOffset, setScale, schedulePublish]);

  // AI: Get current viewport state
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
  }, [svgRef, offset, scale]);

  // AI: Set pan position
  const aiSetPan = useCallback((x: number, y: number) => {
    setOffset({ x, y });
    schedulePublish();
    return { success: true, offsetX: x, offsetY: y };
  }, [setOffset, schedulePublish]);

  return {
    panToCoordinate,
    aiSetZoom,
    aiGetViewport,
    aiSetPan,
  };
}

