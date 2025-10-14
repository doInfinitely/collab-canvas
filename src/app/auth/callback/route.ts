// src/app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(req: Request) {
  const url = new URL(req.url);

  // Query params Supabase may send back
  const code = url.searchParams.get("code");
  const typeParam = url.searchParams.get("type")?.toLowerCase(); // e.g., "magiclink"
  const state = url.searchParams.get("state");                    // present for OAuth
  const tokenHash = url.searchParams.get("token_hash");          // sometimes present

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(list) {
          for (const { name, value, options } of list) {
            cookieStore.set({ name, value, ...options });
          }
        },
      },
    }
  );

  try {
    // Decide which flow this is:
    const looksLikeMagicLink =
      typeParam === "magiclink" ||
      (!!code && !state) ||
      !!tokenHash;

    if (!code && !tokenHash) {
      // We got hit without a token at all (scanner? manual open?)
      return NextResponse.redirect(
        new URL("/login?error=missing_code", url.origin),
        303
      );
    }

    if (looksLikeMagicLink) {
      // --- MAGIC LINK / EMAIL OTP FLOW ---
      // Prefer token_hash param if present; otherwise Supabase sends "code"
      const token = tokenHash ?? code!;
      const otpType =
        typeParam === "recovery" ||
        typeParam === "signup" ||
        typeParam === "invite" ||
        typeParam === "email_change"
          ? (typeParam as
              | "recovery"
              | "signup"
              | "invite"
              | "email_change")
          : ("magiclink" as const);

      const { error } = await supabase.auth.verifyOtp({
        type: otpType,
        token_hash: token,
      });
      if (error) throw error;
    } else {
      // --- OAUTH PKCE FLOW ---
      const { error } = await supabase.auth.exchangeCodeForSession(req.url);
      if (error) throw error;
    }

    // Upsert profile (so presence UI has something to show)
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email ?? null,
      });
    }

    return NextResponse.redirect(new URL("/dashboard", url.origin), 303);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "callback_failed";
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(msg)}`, url.origin),
      303
    );
  }
}
