// Multiplayer cursor display

import React from 'react';
import { colorFor } from '@/lib/canvas/colors';

type RemoteCursor = { worldX: number; worldY: number; at: number };

type MultiplayerCursorsProps = {
  remoteCursors: Map<string, RemoteCursor>;
  offset: { x: number; y: number };
  profiles: Map<string, string>;
};

export const MultiplayerCursors = React.memo(({ remoteCursors, offset, profiles }: MultiplayerCursorsProps) => {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {Array.from(remoteCursors.entries()).map(([uid, rc]) => {
        const sx = rc.worldX - offset.x;
        const sy = rc.worldY - offset.y;
        const email = profiles.get(uid) ?? uid.slice(0, 6);
        const color = colorFor(uid);
        return (
          <div key={uid} className="absolute" style={{ transform: `translate(${sx}px, ${sy}px)` }}>
            <svg width="14" height="20" viewBox="0 0 14 20" className="drop-shadow" style={{ display: "block" }}>
              <path d="M1 1 L13 9 L8 10 L9.5 18 L6.5 18 L5 10 L1 9 Z" fill={color} opacity={0.95}/>
              <path d="M1 1 L13 9 L8 10 L9.5 18 L6.5 18 L5 10 L1 9 Z" fill="none" stroke="black" strokeWidth="0.75"/>
            </svg>
            <div className="mt-[-2px] ml-[10px] rounded px-2 py-0.5 text-[11px] leading-[14px] text-white shadow" style={{ backgroundColor: color }}>
              {email}
            </div>
          </div>
        );
      })}
    </div>
  );
});

MultiplayerCursors.displayName = 'MultiplayerCursors';

