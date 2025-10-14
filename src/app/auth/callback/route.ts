// src/app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const typeParam = url.searchParams.get("type")?.toLowerCase();

  const cookieStore = cookies();   // sync in route handlers
  const h = headers();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // minimal cookie adapter: no fancy typing, no options spreading
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string) {
          cookieStore.set(name, value);         // rely on Next defaults
        },
        remove(name: string) {
          try {
            cookieStore.delete(name);           // Next 13.4+ API
          } catch {
            // fallback: expire if delete isn't available in your channel
            cookieStore.set(name, "", { maxAge: 0 } as any);
          }
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
    if (!code) {
      return NextResponse.redirect(new URL("/login", url.origin), 303);
    }

    if (typeParam) {
      // Magic-link / email verification flows
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
      // OAuth PKCE
      const { error } = await supabase.auth.exchangeCodeForSession(req.url);
      if (error) throw error;
    }

    // Ensure profile row exists so presence can list users
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email ?? null,
      });
    }

    // land in the app
    return NextResponse.redirect(new URL("/dashboard", url.origin), 303);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "callback_failed";
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(msg)}`, url.origin),
      303
    );
  }
}
