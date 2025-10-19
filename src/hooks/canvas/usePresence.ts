// Remote cursor presence tracking and broadcasting

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';

type RemoteCursor = {
  worldX: number;
  worldY: number;
  at: number;
};

function getTabId() {
  // Check if we're in the browser
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
  
  let id = sessionStorage.getItem("tabId");
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    sessionStorage.setItem("tabId", id);
  }
  return id;
}

type UsePresenceProps = {
  userId: string;
  offsetRef: React.RefObject<{ x: number; y: number }>;
  scaleRef: React.RefObject<number>;
  cursorRef: React.RefObject<{ dx: number; dy: number }>;
  screenCursorRef: React.RefObject<{ x: number; y: number }>;
};

export function usePresence({
  userId,
  offsetRef,
  scaleRef,
  cursorRef,
  screenCursorRef,
}: UsePresenceProps) {
  const tabIdRef = useRef(getTabId());
  const presenceChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const rafRef = useRef<number | null>(null);

  const [profiles, setProfiles] = useState<Map<string, string>>(new Map());
  const [remoteCursors, setRemoteCursors] = useState<Map<string, RemoteCursor>>(new Map());

  // Load user profiles
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("id,email");
      if (data) {
        setProfiles(new Map(data.map((r) => [r.id as string, (r.email as string) ?? ""])));
      }
    })();
  }, []);

  // Cleanup stale cursors (older than 4 seconds)
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setRemoteCursors((prev) => {
        const m = new Map(prev);
        for (const [uid, rc] of m) {
          if (now - rc.at > 4000) m.delete(uid);
        }
        return m;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Publish cursor position to presence channel
  const publish = useCallback(() => {
    if (!presenceChRef.current) return;
    const { x: cx, y: cy } = screenCursorRef.current!;
    const worldUnderCursorX = offsetRef.current!.x + cx / scaleRef.current!;
    const worldUnderCursorY = offsetRef.current!.y + cy / scaleRef.current!;
    presenceChRef.current.send({
      type: "broadcast",
      event: "canvas-meta",
      payload: {
        userId,
        tabId: tabIdRef.current,
        page: "canvas",
        scrollX: Math.round(offsetRef.current!.x),
        scrollY: Math.round(offsetRef.current!.y),
        cursorDX: Math.round(cursorRef.current!.dx),
        cursorDY: Math.round(cursorRef.current!.dy),
        sumX: Math.round(offsetRef.current!.x + cursorRef.current!.dx),
        sumY: Math.round(offsetRef.current!.y + cursorRef.current!.dy),
        cursorWorldX: Math.round(worldUnderCursorX),
        cursorWorldY: Math.round(worldUnderCursorY),
        at: new Date().toISOString(),
      },
    });
  }, [userId, offsetRef, scaleRef, cursorRef, screenCursorRef]);

  // Schedule publish using requestAnimationFrame (throttling)
  const schedulePublish = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      publish();
    });
  }, [publish]);

  // Set up presence channel and listeners
  useEffect(() => {
    const ch = supabase.channel("presence:canvas", { config: { presence: { key: userId } } });
    presenceChRef.current = ch;

    ch.on("broadcast", { event: "canvas-meta" }, ({ payload }) => {
      const p = payload as {
        userId: string;
        cursorWorldX?: number;
        cursorWorldY?: number;
        at?: string;
        page?: string;
      };
      if (!p || !p.userId || p.userId === userId) return;
      if (p.page !== "canvas") return;
      if (typeof p.cursorWorldX !== "number" || typeof p.cursorWorldY !== "number") return;
      setRemoteCursors((prev) => {
        const m = new Map(prev);
        m.set(p.userId, {
          worldX: p.cursorWorldX!,
          worldY: p.cursorWorldY!,
          at: p.at ? Date.parse(p.at) : Date.now(),
        });
        return m;
      });
    });

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        try {
          await ch.track({ page: "canvas", tabId: tabIdRef.current, at: new Date().toISOString() });
        } catch {}
        publish();
      }
    });

    const cleanup = async () => {
      try { await ch.untrack(); } catch {}
      try { await new Promise(r => setTimeout(r, 40)); } catch {}
      try { await ch.unsubscribe(); } catch {}
      try { supabase.removeChannel(ch); } catch {}
    };

    const onPageHide = () => { void cleanup(); };
    const onBeforeUnload = () => { void cleanup(); };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      void cleanup();
    };
  }, [publish, userId]);

  return {
    profiles,
    remoteCursors,
    schedulePublish,
  };
}

