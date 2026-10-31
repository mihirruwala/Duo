import "server-only";
import { z } from "zod";
import { parseOrExplain } from "./env";

const supabaseSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20),
});

const livekitSchema = z.object({
  NEXT_PUBLIC_LIVEKIT_URL: z.string().regex(/^wss?:\/\//, "must start with ws:// or wss://"),
  LIVEKIT_API_KEY: z.string().min(3),
  LIVEKIT_API_SECRET: z.string().min(6),
});

let cachedSupabase: z.infer<typeof supabaseSchema> | undefined;
let cachedLivekit: z.infer<typeof livekitSchema> | undefined;

/** Server-only secrets. Importing this file from a client component fails the build. */
export function serverEnv() {
  cachedSupabase ??= parseOrExplain(supabaseSchema, {
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });
  return cachedSupabase;
}

export function livekitEnv() {
  cachedLivekit ??= parseOrExplain(livekitSchema, {
    NEXT_PUBLIC_LIVEKIT_URL: process.env.NEXT_PUBLIC_LIVEKIT_URL,
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
  });
  return cachedLivekit;
}
