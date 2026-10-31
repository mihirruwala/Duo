import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

export type RateLimitRule = { bucket: string; max: number; windowSeconds: number };

export const RATE_LIMITS = {
  livekitToken: { bucket: "livekit.token", max: 30, windowSeconds: 600 },
  gifSearch: { bucket: "gif.search", max: 60, windowSeconds: 60 },
  upload: { bucket: "upload", max: 30, windowSeconds: 600 },
} satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window counter stored in Postgres (works across serverless instances).
 * Fails closed: if the limiter can't be reached, the request is refused.
 */
export async function hitRateLimit(rule: RateLimitRule, subject: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
    p_bucket: rule.bucket,
    p_subject: subject,
    p_max: rule.max,
    p_window_seconds: rule.windowSeconds,
  });
  if (error) {
    log.error("rate_limit.unavailable", { bucket: rule.bucket, error_code: error.code });
    return false;
  }
  return data === true;
}
