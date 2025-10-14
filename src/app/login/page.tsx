// src/app/login/page.tsx
"use client";
import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabase/client";


export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");

  const redirectTo = `${origin}/auth/callback`;

  async function onMagicLink(e: FormEvent) {
    e.preventDefault();
    setStatus("Sending magic link…");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback`,
      },
    });
    setStatus(error ? `Error: ${error.message}` : "Check your email for a sign-in link.");
  }


  async function onGitHub() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo
      },
    });
    if (error) setStatus(`Error: ${error.message}`);
  }


  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>


      <button
        onClick={onGitHub}
        className="w-full rounded-md border px-4 py-2 font-medium hover:bg-gray-100"
      >
        Continue with GitHub
      </button>


      <div className="text-center text-sm text-gray-500">or</div>


      <form onSubmit={onMagicLink} className="space-y-3">
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border px-3 py-2"
        />
        <button
          type="submit"
          className="w-full rounded-md bg-black px-4 py-2 font-medium text-white hover:opacity-90"
        >
        Send magic link
        </button>
      </form>


      {status && <p className="text-sm text-gray-600">{status}</p>}
    </div>
  );
}
