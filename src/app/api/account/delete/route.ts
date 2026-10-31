import type { NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { removeFiles, removeRoomFiles } from "@/features/rooms/server/storage-cleanup";
import { publicEnv } from "@/lib/env";
import { apiError, apiOk, isSameOrigin } from "@/lib/http";
import { log } from "@/lib/log";
import { hitRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/server";

const bodySchema = z.object({ password: z.string().min(1).max(200) });

/**
 * Permanently delete the signed-in account. Requires the current password (a stolen session alone
 * isn't enough). Removes files in rooms they host and files they uploaded elsewhere, then the auth
 * user; database rows cascade from there.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return apiError(403, "forbidden", "Cross-site request refused.");
  const { supabase, user } = await getCurrentUser();
  if (!user?.email) return apiError(401, "not_authenticated", "Please sign in first.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "invalid_request", "Enter your password.");
  if (!(await hitRateLimit({ bucket: "account.delete", max: 5, windowSeconds: 3600 }, user.id))) {
    return apiError(429, "rate_limited", "Too many attempts. Try again later.");
  }

  // Re-authenticate with a throwaway client (doesn't touch the session cookies).
  const env = publicEnv();
  const probe = createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: authError } = await probe.auth.signInWithPassword({ email: user.email, password: parsed.data.password });
  if (authError) return apiError(403, "wrong_password", "That password isn't right.");
  await probe.auth.signOut().catch(() => undefined);

  const admin = createAdminClient();
  const [{ data: hosted }, { data: uploads }] = await Promise.all([
    admin.from("rooms").select("id").eq("host_id", user.id),
    admin.from("attachments").select("storage_path").eq("uploader_id", user.id),
  ]);
  const hostedIds = (hosted ?? []).map((r) => r.id);
  const removed = await removeRoomFiles(hostedIds);
  await removeFiles((uploads ?? []).map((a) => a.storage_path).filter((p) => !hostedIds.some((id) => p.startsWith(`${id}/`))));

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    log.error("account.delete_failed", { user_id: user.id, error_code: error.code });
    return apiError(500, "delete_failed", "Couldn't delete your account. Try again.");
  }
  await supabase.auth.signOut().catch(() => undefined);
  log.info("account.deleted", { user_id: user.id, rooms: hostedIds.length, files_removed: removed });
  return apiOk({ ok: true });
}
