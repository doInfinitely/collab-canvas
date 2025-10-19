// Canvas versioning and export functionality

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { nowIso, resolveSides, deg } from '@/lib/canvas/shapes';
import { shapeCenter, getTextBoxBounds, polygonPoints } from '@/lib/canvas/geometry';
import { renderMarkdown } from '@/lib/canvas/markdown';
import { HEX_RE } from '@/lib/canvas/colors';
import type { Shape } from '@/types/canvas';

const GRID_SIZE = 20;
const DOT_RADIUS = 1.5;
const DOT_COLOR = "rgba(0,0,0,0.15)";

type CanvasVersion = {
  id: string;
  created_at: string;
  created_by: string;
  snapshot: string;
};

type UseCanvasVersioningProps = {
  userId: string;
  shapesRef: React.RefObject<Map<string, Shape>>;
  offsetRef: React.RefObject<{ x: number; y: number }>;
  scaleRef: React.RefObject<number>;
  svgRef: React.RefObject<SVGSVGElement | null>;
  shapeOrdered: Shape[];
  setShapes: (shapes: Map<string, Shape>) => void;
  shapesChRef: React.RefObject<RealtimeChannel | null>;
};

export function useCanvasVersioning({
  userId,
  shapesRef,
  offsetRef,
  scaleRef,
  svgRef,
  shapeOrdered,
  setShapes,
  shapesChRef,
}: UseCanvasVersioningProps) {
  const [canvasVersions, setCanvasVersions] = useState<CanvasVersion[]>([]);

  // Encode canvas to JSON
  const encodeCanvasToJSON = useCallback(() => {
    const canvasState = {
      shapes: Array.from(shapesRef.current!.values()).map(s => ({
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
  }, [userId, shapesRef]);

  // Decode and load canvas from JSON
  const loadCanvasFromJSON = useCallback(async (jsonStr: string) => {
    try {
      const canvasState = JSON.parse(jsonStr);
      if (!canvasState.shapes || !Array.isArray(canvasState.shapes)) {
        throw new Error("Invalid canvas JSON format");
      }

      // Clear existing shapes
      const oldShapes = Array.from(shapesRef.current!.values());
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
  }, [userId, shapesRef, setShapes, shapesChRef]);

  // Build SVG string for export
  const buildExportSVG = useCallback((): string | null => {
    const svg = svgRef.current;
    if (!svg) return null;

    // Get current viewport dimensions
    const rect = svg.getBoundingClientRect();
    const viewportWidth = rect.width || 1200;
    const viewportHeight = rect.height || 800;

    // Calculate visible world coordinates
    const worldLeft = offsetRef.current!.x;
    const worldTop = offsetRef.current!.y;
    const worldWidth = viewportWidth / scaleRef.current!;
    const worldHeight = viewportHeight / scaleRef.current!;

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

      // Add text_md if present
      let textEl = '';
      if (s.text_md && s.text_md.trim()) {
        const { boxW, boxH } = getTextBoxBounds(s);
        const textColor = (s.text_color && HEX_RE.test(s.text_color)) ? s.text_color : '#000000';
        const fontSize = 14;
        
        const htmlContent = renderMarkdown(s.text_md);
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
  }, [svgRef, offsetRef, scaleRef, shapeOrdered]);

  // Export as SVG
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
  }, [buildExportSVG]);

  // Export as PNG
  const exportAsPNG = useCallback(() => {
    const svgString = buildExportSVG();
    if (!svgString) return;

    const live = svgRef.current;
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
      // Fallback: try blob URL
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
  }, [buildExportSVG, svgRef]);

  // Export as JSON
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
  }, [encodeCanvasToJSON, userId, loadCanvasVersions]);

  // Restore a version
  const restoreCanvasVersion = useCallback(async (versionId: string) => {
    const version = canvasVersions.find(v => v.id === versionId);
    if (!version) return false;

    const success = await loadCanvasFromJSON(version.snapshot);
    return success;
  }, [canvasVersions, loadCanvasFromJSON]);

  // Load versions on mount
  useEffect(() => {
    loadCanvasVersions();
  }, [loadCanvasVersions]);

  return {
    canvasVersions,
    exportAsSVG,
    exportAsPNG,
    exportAsJSON,
    saveCanvasVersion,
    restoreCanvasVersion,
    loadCanvasVersions,
    encodeCanvasToJSON,
  };
}

