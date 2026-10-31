import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

const BUCKET = "attachments";

/**
 * Remove every stored file under the given rooms' folders (`<room_id>/<uuid>/<name>`).
 * Supabase only allows deleting objects through the Storage API (not SQL), so this runs server-side
 * with the service role *after* the caller has proven they may delete those rooms.
 */
export async function removeRoomFiles(roomIds: string[]): Promise<number> {
  const storage = createAdminClient().storage.from(BUCKET);
  let removed = 0;
  for (const roomId of roomIds) {
    const paths: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: folders, error } = await storage.list(roomId, { limit: 1000, offset });
      if (error || !folders?.length) break;
      for (const folder of folders) {
        const { data: files } = await storage.list(`${roomId}/${folder.name}`, { limit: 100 });
        for (const f of files ?? []) paths.push(`${roomId}/${folder.name}/${f.name}`);
      }
      if (folders.length < 1000) break;
    }
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await storage.remove(paths.slice(i, i + 100));
      if (error) log.warn("storage.cleanup_failed", { room_id: roomId, error_code: error.name });
      else removed += Math.min(100, paths.length - i);
    }
  }
  return removed;
}

/** Remove specific objects (e.g. files a deleted user uploaded into someone else's room). */
export async function removeFiles(paths: string[]): Promise<void> {
  const storage = createAdminClient().storage.from(BUCKET);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await storage.remove(paths.slice(i, i + 100));
    if (error) log.warn("storage.cleanup_failed", { count: paths.length, error_code: error.name });
  }
}
