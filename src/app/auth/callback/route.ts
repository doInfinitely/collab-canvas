import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const typeParam = url.searchParams.get("type")?.toLowerCase(); // "magiclink", "recovery", etc.
  const tokenHash = url.searchParams.get("token_hash"); // sometimes present

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(list) { for (const { name, value, options } of list) cookieStore.set({ name, value, ...options }); },
      },
    }
  );

  try {
    if (typeParam) {
      // ===== Email link / OTP flows (magiclink, recovery, signup, invite, email_change) =====
      const allowed = new Set(["magiclink","recovery","signup","invite","email_change"] as const);
      const otpType = allowed.has(typeParam as any) ? (typeParam as any) : "magiclink";

      const token = tokenHash ?? code;
      if (!token) {
        return NextResponse.redirect(new URL("/login?error=missing_code", url.origin), 303);
      }

      const { error } = await supabase.auth.verifyOtp({
        type: otpType,            // e.g. "magiclink"
        token_hash: token,        // use code/token_hash as the hash
      });
      if (error) throw error;
    } else {
      // ===== OAuth PKCE (GitHub, etc.) =====
      if (!code) {
        return NextResponse.redirect(new URL("/login?error=missing_code", url.origin), 303);
      }
      const { error } = await supabase.auth.exchangeCodeForSession(req.url);
      if (error) throw error;
    }

    // Ensure profile exists
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

