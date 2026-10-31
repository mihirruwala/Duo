import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MemberRole, ProfileRow, RoomRow } from "@/shared/database";

type Client = SupabaseClient<Database>;

export type RoomMember = { userId: string; role: MemberRole; displayName: string; avatarHue: number };
export type RoomWithMembers = RoomRow & { members: RoomMember[] };

const ROOM_COLUMNS = "id, slug, name, host_id, invite_expires_at, has_open_invite, control_max_seconds, created_at";

async function attachMembers(supabase: Client, rooms: RoomRow[]): Promise<RoomWithMembers[]> {
  if (rooms.length === 0) return [];
  const { data: members, error } = await supabase
    .from("room_members")
    .select("room_id, user_id, role")
    .in(
      "room_id",
      rooms.map((r) => r.id),
    );
  if (error) throw error;

  const userIds = [...new Set(members.map((m) => m.user_id))];
  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_hue")
    .in("id", userIds);
  if (pErr) throw pErr;
  const byId = new Map<string, Pick<ProfileRow, "display_name" | "avatar_hue">>(profiles.map((p) => [p.id, p]));

  return rooms.map((room) => ({
    ...room,
    members: members
      .filter((m) => m.room_id === room.id)
      .sort((a, b) => (a.role === "host" ? -1 : b.role === "host" ? 1 : 0))
      .map((m) => ({
        userId: m.user_id,
        role: m.role,
        displayName: byId.get(m.user_id)?.display_name ?? "Someone",
        avatarHue: byId.get(m.user_id)?.avatar_hue ?? 20,
      })),
  }));
}

/** Rooms the current user is on the allowlist for (RLS does the filtering). */
export async function listMyRooms(supabase: Client): Promise<RoomWithMembers[]> {
  const { data, error } = await supabase.from("rooms").select(ROOM_COLUMNS).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return attachMembers(supabase, data);
}

/**
 * Look up a room by slug. Returns null both when it doesn't exist and when the user is not
 * a member, so a guessed slug is indistinguishable from a real one.
 */
export async function getRoomBySlug(supabase: Client, slug: string): Promise<RoomWithMembers | null> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(slug)) return null;
  const { data, error } = await supabase.from("rooms").select(ROOM_COLUMNS).eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [room] = await attachMembers(supabase, [data]);
  return room ?? null;
}

export async function getMyProfile(supabase: Client, userId: string) {
  const { data, error } = await supabase.from("profiles").select("id, display_name, avatar_hue").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}
