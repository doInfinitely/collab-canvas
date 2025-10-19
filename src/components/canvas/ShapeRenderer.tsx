// Individual shape renderer with text overlay

import React from 'react';
import { resolveSides, deg } from '@/lib/canvas/shapes';
import { shapeCenter, getTextBoxBounds, polygonPoints } from '@/lib/canvas/geometry';
import { renderMarkdown } from '@/lib/canvas/markdown';
import { HEX_RE } from '@/lib/canvas/colors';

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
  name?: string;
  text_md?: string;
  text_color?: string;
};

type ShapeRendererProps = {
  shape: Shape;
  scale: number;
  isSelected: boolean;
  isEditing: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
};

export const ShapeRenderer = React.memo(({
  shape: s,
  scale,
  isSelected,
  isEditing,
  onContextMenu,
}: ShapeRendererProps) => {
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
    filter: isSelected ? "url(#selGlow)" : undefined,
    transform: rotDeg ? `rotate(${rotDeg} ${cx} ${cy})` : undefined,
  };

  // ---- text_md-in-SVG (foreignObject) setup ----
  const hasMD = !!(s.text_md && s.text_md.trim());
  const { boxW, boxH } = getTextBoxBounds(s);
  const boxX = cx - boxW / 2;
  const boxY = cy - boxH / 2;
  const foFontSize = Math.max(10, 14 / scale);
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
      onContextMenu={onContextMenu}
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
          style={{ pointerEvents: "none" }}
          requiredExtensions="http://www.w3.org/1999/xhtml"
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              overflow: "hidden",
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
});

ShapeRenderer.displayName = 'ShapeRenderer';

