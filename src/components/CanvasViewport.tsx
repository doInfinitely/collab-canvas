// src/components/CanvasViewport.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Props = { userId: string };

function getTabId() {
  try { return crypto.randomUUID(); }
  catch { return `tab_${Math.random().toString(36).slice(2)}`; }
}

export default function CanvasViewport({ userId }: Props) {
  // logical “camera” offset in pixels
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 }); // last mouse pos (for drag)
  const rafRef = useRef<number | null>(null);
  const tabIdRef = useRef(getTabId());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // compute cursor displacement from viewport center
  const [cursor, setCursor] = useState({ dx: 0, dy: 0 });

  // publish presence metadata (throttled via rAF)
  const publish = () => {
    if (!channelRef.current) return;
    const { x, y } = offset;
    const { dx, dy } = cursor;
    channelRef.current.track({
      page: "canvas",
      tabId: tabIdRef.current,
      scrollX: Math.round(x),
      scrollY: Math.round(y),
      cursorDX: Math.round(dx),
      cursorDY: Math.round(dy),
      sumX: Math.round(x + dx),
      sumY: Math.round(y + dy),
      at: new Date().toISOString(),
    }).catch(() => {});
  };

  const schedulePublish = () => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      publish();
    });
  };

  useEffect(() => {
    const ch = supabase.channel("presence:canvas", { config: { presence: { key: userId } } });
    channelRef.current = ch;

    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        publish();
      }
    });

    // handle cleanup / tab closing
    const untrackAndClose = async () => {
      try { await ch.untrack(); } catch {}
      try { await new Promise(r => setTimeout(r, 40)); } catch {}
      try { await ch.unsubscribe(); } catch {}
      try { supabase.removeChannel(ch); } catch {}
    };

    const onPageHide = () => { void untrackAndClose(); };
    const onBeforeUnload = () => { void untrackAndClose(); };

    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      void untrackAndClose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // track cursor relative to viewport center
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      setCursor({ dx: e.clientX - cx, dy: e.clientY - cy });
      schedulePublish();
    };
    const onEnter = (e: MouseEvent) => onMove(e);
    const onLeave = () => {
      setCursor({ dx: 0, dy: 0 });
      schedulePublish();
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseenter", onEnter);
    window.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseenter", onEnter);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  // wheel to pan (two-axis)
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // keep the camera in place; we handle “scroll”
      // natural scrolling: deltaX>0 → move right; deltaY>0 → move down
      setOffset((o) => ({ x: o.x + e.deltaX, y: o.y + e.deltaY }));
      schedulePublish();
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // right-click drag to pan (natural panning)
  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      // disable menu so right-drag is smooth
      e.preventDefault();
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 2) return; // right button only
      draggingRef.current = true;
      lastRef.current = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - lastRef.current.x;
      const dy = e.clientY - lastRef.current.y;
      lastRef.current = { x: e.clientX, y: e.clientY };
      // natural: drag left → content moves left → we increase offset by dx
      setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
      schedulePublish();
    };
    const onUp = () => { draggingRef.current = false; };

    window.addEventListener("contextmenu", onContext);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // CSS background with infinite dot grid; we shift by background-position
  const gridSize = 24; // px between dots
  const grid = {
    backgroundImage:
      "radial-gradient(#9ca3af 1px, transparent 1px)", // gray-400 dots
    backgroundSize: `${gridSize}px ${gridSize}px`,
    backgroundPosition: `${-offset.x % gridSize}px ${-offset.y % gridSize}px`,
  } as const;

  return (
    <div className="relative h-full w-full overflow-hidden bg-white select-none">
      {/* Dot grid layer */}
      <div className="absolute inset-0" style={grid} />
      {/* Center crosshair (optional) */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-0.5 -translate-y-0.5">
        <div className="h-1 w-1 rounded-full bg-gray-400" />
      </div>

      {/* HUD readout (for your own view) */}
      <div className="absolute bottom-3 left-3 rounded bg-white/80 px-3 py-2 text-xs shadow">
        <div>scroll: ({Math.round(offset.x)}, {Math.round(offset.y)})</div>
        <div>cursorΔ: ({Math.round(cursor.dx)}, {Math.round(cursor.dy)})</div>
        <div>sum: ({Math.round(offset.x + cursor.dx)}, {Math.round(offset.y + cursor.dy)})</div>
        <div className="opacity-60">Drag RMB or use trackpad</div>
      </div>
    </div>
  );
}
