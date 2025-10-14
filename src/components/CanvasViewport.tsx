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
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 }); // last mouse pos (for drag)
  const rafRef = useRef<number | null>(null);
  const tabIdRef = useRef(getTabId());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // compute cursor displacement from viewport center
  const [cursor, setCursor] = useState({ dx: 0, dy: 0 });

  // add refs that mirror state
  const offsetRef = useRef(offset);
  useEffect(() => { offsetRef.current = offset; }, [offset]);

  const cursorRef = useRef(cursor);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  const publish = () => {
    if (!channelRef.current) return;
    const { x, y } = offsetRef.current;     // <-- use refs (fresh)
    const { dx, dy } = cursorRef.current;   // <-- use refs (fresh)

    channelRef.current.send({
      type: "broadcast",
      event: "canvas-meta",
      payload: {
        userId,
        tabId: tabIdRef.current,
        page: "canvas",
        scrollX: Math.round(x),
        scrollY: Math.round(y),
        cursorDX: Math.round(dx),
        cursorDY: Math.round(dy),
        sumX: Math.round(x + dx),
        sumY: Math.round(y + dy),
        at: new Date().toISOString(),
      },
    });
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

      ch.subscribe(async (status) => {
        console.log("[CanvasViewport] subscribe status:", status);    // <— add this
        if (status === "SUBSCRIBED") {
          try { await ch.track({ page: "canvas", tabId: tabIdRef.current, at: new Date().toISOString() }); } catch {}
          publish(); // first telemetry
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

  // Draw a dot grid on a canvas
  const gridSize = 24;           // spacing
  const dotRadius = 1.5;         // dot size in px
  const dotColor = "#9ca3af";    // gray-400

  // In the resize effect, keep as-is but ensure we draw even if initial client size is 0
  useEffect(() => {
    const canvas = gridCanvasRef.current;
    if (!canvas) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);

    const resize = () => {
      // Guard against initial 0x0
      const w = Math.max(1, canvas.clientWidth);
      const h = Math.max(1, canvas.clientHeight);

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);

      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale once per draw pass

      drawGrid();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Force a pass on the next frame (after layout)
    requestAnimationFrame(resize);

    return () => ro.disconnect();
  }, []);

  // Redraw when offset changes
  useEffect(() => {
    drawGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset.x, offset.y]);

  const drawGrid = () => {
    const canvas = gridCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear the bitmap irrespective of the current transform
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    const ox = ((-offset.x % gridSize) + gridSize) % gridSize;
    const oy = ((-offset.y % gridSize) + gridSize) % gridSize;

    ctx.fillStyle = "#9ca3af"; // gray-400
    for (let y = oy; y <= h; y += gridSize) {
      for (let x = ox; x <= w; x += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-white select-none">
      {/* Dot grid layer (canvas) */}
      <canvas
        ref={gridCanvasRef}
        className="absolute inset-0 block w-full h-full"
        aria-hidden
      />
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
