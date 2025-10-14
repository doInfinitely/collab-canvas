// src/lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";

export function createSupabaseServer() {
  // Minimal helper that doesn't read/set cookies (good enough if unused).
  // If/when you need this for a Route Handler, switch to getAll/setAll there.
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Deprecated cookie interface is fine here; we return nothing and set no cookies.
      cookies: {
        get(_name: string) {
          return undefined;
        },
        set(
          _name: string,
          _value: string,
          _options?: Record<string, unknown>
        ) {
          /* no-op */
        },
        remove(_name: string, _options?: Record<string, unknown>) {
          /* no-op */
        },
      },
    }
  );
}

