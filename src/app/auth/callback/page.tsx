// src/app/auth/callback/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function AuthCallback() {
  const [msg, setMsg] = useState("Finishing sign-in…");
  const router = useRouter();

  useEffect(() => {
    (async () => {
      // If we already have a session, bail out.
      const existing = await supabase.auth.getSession();
      if (existing.data.session) {
        router.replace("/dashboard");
        return;
      }

      // 1) Implicit/hash flow: #access_token / #refresh_token (OAuth or magic link)
      const hash = window.location.hash?.startsWith("#")
        ? new URLSearchParams(window.location.hash.slice(1))
        : null;
      const access_token = hash?.get("access_token");
      const refresh_token = hash?.get("refresh_token");

      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (!error) {
          // ensure profile row
          const { data: { user } } = await supabase.auth.getUser();
          if (user) await supabase.from("profiles").upsert({ id: user.id, email: user.email ?? null });
          router.replace("/dashboard");
          return;
        }
        setMsg(`Auth error: ${error.message}`);
        return;
      }

      // 2) Query param ?code=... (can be OAuth PKCE OR email magic-link)
      const href = window.location.href;
      const search = new URLSearchParams(window.location.search);
      const code = search.get("code");
      const type = (search.get("type") || "").toLowerCase(); // 'magiclink', 'recovery', 'invite', 'signup', 'email_change', etc.

      if (code) {
        if (type) {
          // === EMAIL / MAGIC-LINK path ===
          // Supabase returns `?type=magiclink` (or recovery, etc.) with a token_hash in `code`
          const { error } = await supabase.auth.verifyOtp({
            type: type as any,      // 'magiclink' | 'recovery' | 'signup' | 'invite' | 'email_change'
            token_hash: code,
          });
          if (!error) {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) await supabase.from("profiles").upsert({ id: user.id, email: user.email ?? null });
            router.replace("/dashboard");
            return;
          }
          setMsg(`Auth error: ${error.message}`);
          return;
        } else {
          // === OAUTH PKCE path === (GitHub, etc.)
          const { error } = await supabase.auth.exchangeCodeForSession(href);
          if (!error) {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) await supabase.from("profiles").upsert({ id: user.id, email: user.email ?? null });
            router.replace("/dashboard");
            return;
          }
          // Double-check if session exists anyway (race)
          const after = await supabase.auth.getSession();
          if (after.data.session) {
            router.replace("/dashboard");
            return;
          }
          setMsg(`Auth error: ${error.message}`);
          return;
        }
      }

      // 3) Nothing to do
      setMsg("No auth parameters found. Redirecting to login…");
      router.replace("/login");
    })();
  }, [router]);

  return <p className="text-sm text-gray-600">{msg}</p>;
}
