import { z } from "zod";

/** What each person shares about themselves on a room's private channel (validated on receipt). */
export const presenceMetaSchema = z.object({
  where: z.enum(["home", "room"]),
  inCall: z.boolean(),
  at: z.string().max(40),
});
export type PresenceMeta = z.infer<typeof presenceMetaSchema>;

export type PartnerPresence = { online: boolean; where: "home" | "room" | null; inCall: boolean };
export const OFFLINE: PartnerPresence = { online: false, where: null, inCall: false };

/**
 * Collapse a channel's presence state into "where is my person". If they have several tabs open,
 * the most engaged one wins (in a call > in the room > on Home).
 */
export function partnerPresenceFrom(state: Record<string, unknown[]>, myId: string): PartnerPresence {
  let best: PartnerPresence = OFFLINE;
  const rank = (p: PartnerPresence) => (p.inCall ? 3 : p.where === "room" ? 2 : p.online ? 1 : 0);
  for (const [key, metas] of Object.entries(state)) {
    if (key === myId) continue;
    for (const raw of metas) {
      const parsed = presenceMetaSchema.safeParse(raw);
      const p: PartnerPresence = parsed.success
        ? { online: true, where: parsed.data.where, inCall: parsed.data.inCall }
        : { online: true, where: null, inCall: false };
      if (rank(p) > rank(best)) best = p;
    }
  }
  return best;
}

export const KNOCK_EVENT = "knock";
export const KNOCK_COOLDOWN_MS = 10_000;
