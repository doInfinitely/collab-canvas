// Text editing overlay

import React from 'react';
import { shapeCenter, getTextBoxBounds } from '@/lib/canvas/geometry';

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

type TextEditorOverlayProps = {
  shapes: Shape[];
  editingTextId: string | null;
  editingText: string;
  offset: { x: number; y: number };
  scale: number;
  onTextChange: (text: string) => void;
  onTextBlur: () => void;
};

export const TextEditorOverlay = React.memo(({
  shapes,
  editingTextId,
  editingText,
  offset,
  scale,
  onTextChange,
  onTextBlur,
}: TextEditorOverlayProps) => {
  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {shapes.map((s) => {
        const isEditing = editingTextId === s.id;
        if (!isEditing) return null;

        const { cx, cy } = shapeCenter(s);
        const { boxW, boxH } = getTextBoxBounds(s);

        const screenX = (cx - offset.x) * scale;
        const screenY = (cy - offset.y) * scale;
        const screenW = boxW * scale;
        const screenH = boxH * scale;

        const zForEditor = 1000 + (Number.isFinite(s.z as number) ? (s.z as number) : 0);

        return (
          <div
            key={`text-editor-${s.id}`}
            className="absolute"
            style={{
              left: screenX - screenW / 2,
              top: screenY - screenH / 2,
              width: screenW,
              height: screenH,
              pointerEvents: "auto",
              zIndex: zForEditor,
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <textarea
              className="w-full h-full p-2 text-sm border-2 border-blue-500 rounded bg-white resize-none outline-none"
              style={{ fontSize: Math.max(10, 14 * scale) }}
              value={editingText}
              onChange={(e) => onTextChange(e.target.value)}
              onBlur={onTextBlur}
              autoFocus
            />
          </div>
        );
      })}
    </div>
  );
});

TextEditorOverlay.displayName = 'TextEditorOverlay';

