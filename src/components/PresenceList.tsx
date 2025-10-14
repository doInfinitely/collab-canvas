"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Profile = { id: string; email: string | null };

type CanvasMeta = {
  page?: string;
  tabId?: string;
  scrollX?: number;
  scrollY?: number;
  cursorDX?: number;
  cursorDY?: number;
  sumX?: number;
  sumY?: number;
  at?: string;
};

export default function PresenceList({ userId }: { userId: string }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [onlineDashboard, setOnlineDashboard] = useState<Set<string>>(new Set());
  const [canvasState, setCanvasState] = useState<Map<string, CanvasMeta>>(new Map());
  const dashChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const canvasChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,email")
        .order("email", { ascending: true });
      if (!active) return;
      if (!error && data) setProfiles(data);
    })();

    // Dashboard presence (green/gray dot for being on dashboard)
    const dash = supabase.channel("presence:dashboard", {
      config: { presence: { key: userId } },
    });
    dashChRef.current = dash;

    const recomputeDash = () => {
      const state = dash.presenceState() as Record<string, Array<Record<string, unknown>>>;
      setOnlineDashboard(new Set(Object.keys(state)));
    };

    dash.on("presence", { event: "sync" }, recomputeDash);
    dash.on("presence", { event: "join" }, recomputeDash);
    dash.on("presence", { event: "leave" }, recomputeDash);

    dash.subscribe((status) => {
      if (status === "SUBSCRIBED") dash.track({ at: new Date().toISOString() }).catch(() => {});
    });

    // create the channel
    const canvas = supabase.channel("presence:canvas", {
      config: {
        presence: { key: userId },
        broadcast: { self: true }, // harmless for multi-user; helpful for solo tests
      },
    });

    // presence still used to know who’s on the canvas
    const recomputeCanvasPresence = () => {
      const raw = canvas.presenceState() as Record<string, Array<CanvasMeta>>;
      setCanvasState((prev) => {
        const m = new Map(prev);
        // mark who is on canvas
        for (const [uid, metas] of Object.entries(raw ?? {})) {
          const last = metas?.[metas.length - 1] ?? {};
          const ex = m.get(uid) ?? {};
          m.set(uid, { ...ex, page: last.page ?? ex.page });
        }
        // clear the page flag (but keep last numbers) for leavers
        for (const uid of m.keys()) {
          if (!raw?.[uid]) {
            const ex = m.get(uid)!;
            m.set(uid, { ...ex, page: undefined });
          }
        }
        return m;
      });
    };

    canvas.on("presence", { event: "sync" }, recomputeCanvasPresence);
    canvas.on("presence", { event: "join" }, recomputeCanvasPresence);
    canvas.on("presence", { event: "leave" }, recomputeCanvasPresence);

    canvas.on(
      "broadcast",
      { event: "canvas-meta" },
      ({ payload }: { payload: (CanvasMeta & { userId: string }) }) => {
        // Debug: prove we’re seeing the other user’s data
        console.log("[PresenceList] rx broadcast from", payload.userId, payload);

        setCanvasState((prev) => {
          const m = new Map(prev);
          const ex = m.get(payload.userId) ?? {};
          // merge so we don't lose `page` (or any prior fields)
          m.set(payload.userId, { ...ex, ...payload });
          return m;
        });
      }
    );

    canvas.subscribe((status) => {
      console.log("[PresenceList] subscribe status:", status);        // <— add this
    });

    // cleanup
    return () => {
      active = false;
      try { dash.untrack(); } catch {}
      try { dash.unsubscribe(); } catch {}
      try { supabase.removeChannel(dash); } catch {}
      try { canvas.untrack(); } catch {}
      try { canvas.unsubscribe(); } catch {}
      try { supabase.removeChannel(canvas); } catch {}
    };
  }, [userId]);

  const rows = useMemo(() => {
    return profiles.map((p) => {
      const onDash = onlineDashboard.has(p.id);
      const canvas = canvasState.get(p.id);
      const onCanvas = !!canvas && canvas.page === "canvas";
      return {
        id: p.id,
        email: p.email ?? "(no email)",
        online: onDash || onCanvas, // green if on dashboard or canvas
        onCanvas,
        canvas,
      };
    });
  }, [profiles, onlineDashboard, canvasState]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Presence</h2>
      <ul className="divide-y rounded-md border bg-white">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start gap-3 px-4 py-2">
            <svg aria-label={r.online ? "online" : "offline"} className="mt-1 shrink-0" width="12" height="12" viewBox="0 0 12 12">
              <circle cx="6" cy="6" r="6" fill={r.online ? "#22c55e" : "#9ca3af"} />
            </svg>

            <div className="flex-1">
              <div className="text-sm">
                {r.email}
                {r.id === userId && (
                  <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">you</span>
                )}
                {r.onCanvas && <span className="ml-2 rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">canvas</span>}
              </div>

              {/* Tuples: only when on the Canvas page */}
              {r.onCanvas && r.canvas && (
                <div className="mt-1 grid grid-cols-1 gap-1 text-xs text-gray-600 sm:grid-cols-3">
                  <div>scroll: ({r.canvas.scrollX ?? 0}, {r.canvas.scrollY ?? 0})</div>
                  <div>cursorΔ: ({r.canvas.cursorDX ?? 0}, {r.canvas.cursorDY ?? 0})</div>
                  <div>sum: ({r.canvas.sumX ?? 0}, {r.canvas.sumY ?? 0})</div>
                </div>
              )}
            </div>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-4 py-3 text-sm text-gray-500">No users yet.</li>
        )}
      </ul>
    </div>
  );
}
