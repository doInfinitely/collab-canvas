import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

type OtpType = "magiclink" | "recovery" | "signup" | "invite" | "email_change";

export async function GET(req: Request) {
  const url = new URL(req.url);

  const code = url.searchParams.get("code");
  const typeParam = url.searchParams.get("type")?.toLowerCase();
  const tokenHash = url.searchParams.get("token_hash");
  const state = url.searchParams.get("state");

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
    const looksLikeOtp: boolean =
      (typeof typeParam === "string" && ["magiclink","recovery","signup","invite","email_change"].includes(typeParam)) ||
      (!!code && !state) ||
      !!tokenHash;

    if (!code && !tokenHash) {
      return NextResponse.redirect(new URL("/login?error=missing_code", url.origin), 303);
    }

    if (looksLikeOtp) {
      const allowed = new Set<OtpType>(["magiclink","recovery","signup","invite","email_change"]);
      const candidate = (typeParam ?? "magiclink") as OtpType;
      const otpType: OtpType = allowed.has(candidate) ? candidate : "magiclink";

      const token = (tokenHash ?? code)!;

      const { error } = await supabase.auth.verifyOtp({
        type: otpType,
        token_hash: token,
      });
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

