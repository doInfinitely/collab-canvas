// src/components/SignOutButton.tsx
"use client";
import { supabase } from "@/lib/supabase/client";

export default function SignOutButton() {
  return (
    <form
      action={async () => {
        try { await supabase.removeAllChannels(); } catch {}
        await supabase.auth.signOut();
        window.location.href = "/";
      }}
    >
      <button className="rounded-md border px-3 py-2 hover:bg-gray-100">Sign out</button>
    </form>
  );
}
