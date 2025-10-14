// src/app/canvas/page.tsx
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import CanvasViewport from "@/components/CanvasViewport";

export default async function CanvasPage() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(_cookies) { /* no-op */ },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // ensure profile exists (optional safety)
  await supabase.from("profiles").upsert({ id: user.id, email: user.email ?? null });

  return (
    <div className="w-screen h-[calc(100vh-64px)]">
      <CanvasViewport userId={user.id} />
    </div>
  );
}
