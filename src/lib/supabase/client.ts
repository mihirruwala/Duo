"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/shared/database";

let client: SupabaseClient<Database> | undefined;

/** Singleton browser client. Session lives in cookies so the server can read it. */
export function getBrowserClient(): SupabaseClient<Database> {
  if (!client) {
    const env = publicEnv();
    client = createBrowserClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  }
  return client;
}
