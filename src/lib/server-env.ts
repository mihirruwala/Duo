import "server-only";
import { z } from "zod";
import { parseOrExplain } from "./env";

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20),
});

let cached: z.infer<typeof serverSchema> | undefined;

/** Server-only secrets. Importing this file from a client component fails the build. */
export function serverEnv() {
  cached ??= parseOrExplain(serverSchema, {
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });
  return cached;
}
