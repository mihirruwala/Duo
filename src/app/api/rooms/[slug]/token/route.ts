import type { NextRequest } from "next/server";
import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { getMyProfile, getRoomBySlug } from "@/features/rooms/server/queries";
import { apiError, apiOk, isSameOrigin } from "@/lib/http";
import { log } from "@/lib/log";
import { hitRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { livekitEnv } from "@/lib/server-env";
import { getCurrentUser } from "@/lib/supabase/server";
import type { CallTokenResponse } from "@/shared/call";
import { tokenSchema } from "@/shared/invite";

const TOKEN_TTL = "10m";

/**
 * Mints a LiveKit access token for one room member.
 * Identity and room come from the verified session + allowlist, never from the client.
 * Non-members get the same 404 as a nonexistent room.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/rooms/[slug]/token">) {
  if (!isSameOrigin(request)) return apiError(403, "forbidden", "Cross-site request refused.");

  const { supabase, user } = await getCurrentUser();
  if (!user) return apiError(401, "not_authenticated", "Please sign in first.");

  const { slug } = await ctx.params;
  if (!tokenSchema.safeParse(slug).success) return apiError(404, "room_not_found", "Room not found.");

  if (!(await hitRateLimit(RATE_LIMITS.livekitToken, user.id))) {
    return apiError(429, "rate_limited", "Too many join attempts. Wait a moment.", { "Retry-After": "60" });
  }

  const [room, profile] = await Promise.all([getRoomBySlug(supabase, slug), getMyProfile(supabase, user.id)]);
  if (!room || !room.members.some((m) => m.userId === user.id)) {
    log.info("livekit.token.denied", { user_id: user.id });
    return apiError(404, "room_not_found", "Room not found.");
  }

  const env = livekitEnv();

  // Defence in depth: cap the media room at two participants even if a token leaked.
  try {
    const svc = new RoomServiceClient(
      env.NEXT_PUBLIC_LIVEKIT_URL.replace(/^ws/, "http"),
      env.LIVEKIT_API_KEY,
      env.LIVEKIT_API_SECRET,
    );
    await svc.createRoom({ name: room.id, maxParticipants: 2, emptyTimeout: 300, departureTimeout: 20 });
  } catch (err) {
    log.warn("livekit.create_room_failed", { room_id: room.id, err: err as Error });
  }

  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: user.id,
    name: profile?.display_name ?? "Someone",
    metadata: JSON.stringify({ hue: profile?.avatar_hue ?? 20 }),
    ttl: TOKEN_TTL,
  });
  at.addGrant({
    room: room.id,
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    canPublishData: true,
    canUpdateOwnMetadata: false,
    canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
  });

  // The media key comes from the database under the member's own session (RLS), never from LiveKit.
  let e2eeKey: string | null = null;
  if (room.e2ee_enabled) {
    const { data } = await supabase.from("rooms").select("media_key").eq("id", room.id).single();
    e2eeKey = data?.media_key ?? null;
    if (!e2eeKey) return apiError(500, "e2ee_unavailable", "Couldn't set up encryption for this call.");
  }

  log.info("livekit.token.issued", { room_id: room.id, user_id: user.id, e2ee: room.e2ee_enabled });
  return apiOk<CallTokenResponse>({ token: await at.toJwt(), url: env.NEXT_PUBLIC_LIVEKIT_URL, e2eeKey });
}
