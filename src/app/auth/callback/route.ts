// src/app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const typeParam = url.searchParams.get("type")?.toLowerCase();

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set({ name, value, ...options });
          }
        },
      },
    }
  );

  try {
    if (!code) {
      return NextResponse.redirect(new URL("/login", url.origin), 303);
    }

    if (typeParam) {
      type OtpType = "magiclink" | "recovery" | "signup" | "invite" | "email_change";
      const allowed = new Set<OtpType>(["magiclink", "recovery", "signup", "invite", "email_change"]);
      const otpType: OtpType = allowed.has(typeParam as OtpType) ? (typeParam as OtpType) : "magiclink";

      const { error } = await supabase.auth.verifyOtp({ type: otpType, token_hash: code });
      if (error) throw error;
    } else {
      const { error } = await supabase.auth.exchangeCodeForSession(req.url);
      if (error) throw error;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").upsert({ id: user.id, email: user.email ?? null });
    }

    return NextResponse.redirect(new URL("/dashboard", url.origin), 303);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "callback_failed";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, url.origin), 303);
  }
}

