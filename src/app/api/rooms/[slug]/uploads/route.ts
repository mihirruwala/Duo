import type { NextRequest } from "next/server";
import { getRoomBySlug } from "@/features/rooms/server/queries";
import { apiError, apiOk, isSameOrigin } from "@/lib/http";
import { log } from "@/lib/log";
import { hitRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/supabase/server";
import { sanitizeFileName, uploadRequestSchema, type UploadResponse } from "@/shared/chat";
import { tokenSchema } from "@/shared/invite";

/**
 * Issues a one-time signed upload URL into `<room_id>/<random>/<safe name>`.
 * Signed with the *user's* session, so storage RLS (members only, own room folder) applies;
 * the bucket itself enforces size + MIME limits on the actual upload.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/rooms/[slug]/uploads">) {
  if (!isSameOrigin(request)) return apiError(403, "forbidden", "Cross-site request refused.");

  const { supabase, user } = await getCurrentUser();
  if (!user) return apiError(401, "not_authenticated", "Please sign in first.");

  const { slug } = await ctx.params;
  if (!tokenSchema.safeParse(slug).success) return apiError(404, "room_not_found", "Room not found.");

  const parsed = uploadRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "invalid_upload", parsed.error.issues[0]?.message ?? "Invalid file.");

  if (!(await hitRateLimit(RATE_LIMITS.upload, user.id))) {
    return apiError(429, "rate_limited", "Too many uploads. Wait a few minutes.", { "Retry-After": "120" });
  }

  const room = await getRoomBySlug(supabase, slug);
  if (!room) return apiError(404, "room_not_found", "Room not found.");

  const fileName = sanitizeFileName(parsed.data.fileName);
  const path = `${room.id}/${crypto.randomUUID()}/${fileName}`;
  const { data, error } = await supabase.storage.from("attachments").createSignedUploadUrl(path);
  if (error || !data) {
    log.warn("upload.sign_failed", { room_id: room.id, user_id: user.id, error_code: error?.name });
    return apiError(500, "upload_failed", "Couldn't prepare the upload. Try again.");
  }

  return apiOk<UploadResponse>({ path, signedUrl: data.signedUrl, fileName });
}
