// src/app/auth/finish/page.tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function AuthFinish() {
  const [msg, setMsg] = useState("Finalizing sign-in…");
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const hash = window.location.hash?.startsWith("#")
        ? new URLSearchParams(window.location.hash.slice(1))
        : null;

      const access_token = hash?.get("access_token");
      const refresh_token = hash?.get("refresh_token");

      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) {
          setMsg(`Auth error: ${error.message}`);
          return;
        }

        // Upsert the user's profile so they appear in the list
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("profiles").upsert({ id: user.id, email: user.email ?? null });
        }

        router.replace("/dashboard");
        return;
      }

      setMsg("No auth tokens found. Redirecting to login…");
      router.replace("/login");
    })();
  }, [router]);

  return <p className="text-sm text-gray-600">{msg}</p>;
}
