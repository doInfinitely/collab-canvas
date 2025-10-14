// src/app/dashboard/page.tsx
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import SignOutButton from "@/components/SignOutButton";
import PresenceList from "@/components/PresenceList";

export default async function DashboardPage() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // RSC can't reliably set cookies here; provide a typed no-op to satisfy SSR adapter
        setAll(_cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          // no-op in server components
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 👇 ensure the user has a profile row (server-side, so it's definitely authed)
  await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email ?? null,
  });

  return (
    <div className="prose">
      <h1>Dashboard</h1>
      <p>You are signed in as <strong>{user.email}</strong></p>
      <PresenceList userId={user.id} />
      <SignOutButton />
    </div>
  );
}
