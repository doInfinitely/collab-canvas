// Debug heads-up display showing canvas state

import React from 'react';

type DebugHUDProps = {
  visible: boolean;
  offset: { x: number; y: number };
  scale: number;
  cursor: { dx: number; dy: number };
};

export const DebugHUD = React.memo(({ visible, offset, scale, cursor }: DebugHUDProps) => {
  if (!visible) return null;

  return (
    <div className="absolute bottom-3 left-3 rounded bg-white/80 px-3 py-2 text-xs shadow">
      <div>scroll: ({Math.round(offset.x)}, {Math.round(offset.y)})</div>
      <div>zoom: {scale.toFixed(2)}×</div>
      <div>cursorΔ: ({Math.round(cursor.dx)}, {Math.round(cursor.dy)})</div>
      <div>sum: ({Math.round(offset.x + cursor.dx)}, {Math.round(offset.y + cursor.dy)})</div>
      <div className="opacity-60">
        Wheel pan • RMB pan • Ctrl/Cmd+Wheel zoom • LMB create/move • Perimeter drag = resize • Cmd/Ctrl+Perimeter drag = rotate • Dbl-click delete (sel=all) • Shift+Click select • Shift+Drag (bg) marquee • Cmd/Ctrl+C/X/V • RMB on shape → Properties • Click text to edit • RMB on background → Canvas menu • ? toggles HUD
      </div>
    </div>
  );
});

DebugHUD.displayName = 'DebugHUD';

