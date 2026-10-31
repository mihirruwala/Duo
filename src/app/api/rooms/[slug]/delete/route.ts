import type { NextRequest } from "next/server";
import { getRoomBySlug } from "@/features/rooms/server/queries";
import { removeRoomFiles } from "@/features/rooms/server/storage-cleanup";
import { apiError, apiOk, isSameOrigin } from "@/lib/http";
import { log } from "@/lib/log";
import { getCurrentUser } from "@/lib/supabase/server";
import { tokenSchema } from "@/shared/invite";

/**
 * Host deletes a room: its files first (Storage API), then the row. RLS on the delete means only
 * the host's own session can remove it; rows cascade (members, messages, reactions, Moments, audit log).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/rooms/[slug]/delete">) {
  if (!isSameOrigin(request)) return apiError(403, "forbidden", "Cross-site request refused.");
  const { supabase, user } = await getCurrentUser();
  if (!user) return apiError(401, "not_authenticated", "Please sign in first.");
  const { slug } = await ctx.params;
  if (!tokenSchema.safeParse(slug).success) return apiError(404, "room_not_found", "Room not found.");

  const room = await getRoomBySlug(supabase, slug);
  if (!room || room.host_id !== user.id) return apiError(404, "room_not_found", "Room not found.");

  const removed = await removeRoomFiles([room.id]);
  const { error } = await supabase.from("rooms").delete().eq("id", room.id);
  if (error) return apiError(500, "delete_failed", "Couldn't delete the room. Try again.");
  log.info("room.deleted", { room_id: room.id, user_id: user.id, files_removed: removed });
  return apiOk({ ok: true });
}
