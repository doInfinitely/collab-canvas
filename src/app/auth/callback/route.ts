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

    if (looksLike

