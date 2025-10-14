// src/app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const typeParam = url.searchParams.get("type")?.toLowerCase();

  // Next.js route handlers: cookies() is sync
  const cookieStore = cookies();
  const h = headers();

  // Infer the exact options type that next/headers accepts for set()
  type NextCookieOptions = Parameters<typeof cookieStore.set>[2];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Use the modern cookie interface (get/set/remove)
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options?: NextCookieOptions) {
          cookieStore.set(name, value, options);
        },
        remove(name: string, options?: NextCookieOptions) {
          // Expire the cookie
          cookieStore.set(name, "", { ...options, maxAge: 0 });
        },
      },
      // Pass through headers (needed for PKCE/verifier propagation)
      headers: {
        get(key: string) {
          return h.get(key) ?? undefined;
        },
      },
    }
  );

  try {
    if (code) {
      if (typeParam) {
        // Magic-link style callbacks
        type OtpType =
          | "magiclink"
          | "recovery"
          | "signup"
          | "invite"
          | "email_change";
        const allowed = new Set<OtpType>([
          "magiclink",
          "recovery",
          "signup",
          "invite",
          "email_change",
        ]);
        const otpType: OtpType = allowed.has(typeParam as OtpType)
          ? (typeParam as OtpType)
          : "magiclink";

        const { error } = await supabase.auth.verifyOtp({
          type: otpType,
          token_hash: code,
        });
        if (error) throw error;
      } else {
        // OAuth (e.g., GitHub) PKCE exchange
        const { error } = await supabase.auth.exchangeCodeForSession(req.url);
        if (error) throw error;
      }

      // Ensure a profile row exists
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("profiles")
          .upsert({ id: user.id, email: user.email ?? null });
      }

      // Hard redirect to dashboard after cookies are set
      return NextResponse.redirect(new URL("/dashboard", url.origin), 303);
    }

    // No "code" query param (server cannot see hash fragments) → send to login
    return NextResponse.redirect(new URL("/login", url.origin), 303);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "callback_failed";
    const params = new URLSearchParams({ error: message });
    return NextResponse.redirect(new URL(`/login?${params}`, url.origin), 303);
  }
}

