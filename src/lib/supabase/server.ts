import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/shared/database";

/** Supabase client bound to the current request's auth cookies. RLS applies. */
export async function createClient() {
  const env = publicEnv();
  const cookieStore = await cookies();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/** Verified current user (validates the JWT signature), or null. */
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return { supabase, user: null } as const;
  return { supabase, user: { id: data.claims.sub, email: data.claims.email as string | undefined } } as const;
}
