// src/app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const type = url.searchParams.get("type")?.toLowerCase(); // 'magiclink' | 'recovery' | 'invite' | 'signup' | 'email_change'

  const cookieStore = cookies();
  const h = headers();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options as any);
          });
        },
      },
      headers: {
        get(key: string) {
          return h.get(key) ?? undefined;
        },
      },
    }
  );

  try {
    if (code) {
      if (type) {
        // Email magic-link style callback
        const allowed = new Set([
          "magiclink",
          "recovery",
          "invite",
          "signup",
          "email_change",
        ] as const);
        const otpType = allowed.has(type as any) ? (type as any) : "magiclink";
        const { error } = await supabase.auth.verifyOtp({
          type: otpType,
          token_hash: code,
        });
        if (error) throw error;
      } else {
        // OAuth PKCE callback (e.g. GitHub)
        const { error } = await supabase.auth.exchangeCodeForSession(req.url);
        if (error) throw error;
      }

      // Ensure profile row exists
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("profiles").upsert({ id: user.id, email: user.email ?? null });
      }

      // Hard redirect to dashboard
      return NextResponse.redirect(new URL("/dashboard", url.origin), 303);
    }

    // We can't read #hash on the server; send them to login to retry
    return NextResponse.redirect(new URL("/login", url.origin), 303);
  } catch (e: any) {
    const params = new URLSearchParams({ error: e.message ?? "callback_failed" });
    return NextResponse.redirect(new URL(`/login?${params}`, url.origin), 303);
  }
}
