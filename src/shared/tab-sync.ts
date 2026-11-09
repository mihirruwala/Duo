import { z } from "zod";

/**
 * Sync a show: each person plays the same show in their own browser tab, on their own account
 * (Netflix, Disney+, Prime Video, any site with a <video>). The DUO Control extension watches the
 * video in the tab each person picked; only "play / pause at t" messages cross the call, like Watch
 * Together for YouTube. Nothing about the page except its title and host is sent.
 */
export const TAB_SYNC_TOPIC = "duo.tabsync";

const seconds = z
  .number()
  .finite()
  .min(0)
  .max(60 * 60 * 24);
export const tabInfoSchema = z.object({
  title: z.string().max(120),
  host: z.string().max(100),
});
export type TabInfo = z.infer<typeof tabInfoSchema>;

export const playbackSchema = z.object({ at: seconds, playing: z.boolean(), hb: z.boolean().optional() });

/** DUO page ↔ DUO page, over LiveKit data. */
export const tabSyncMessageSchema = z.discriminatedUnion("t", [
  /** I synced a tab (or changed what it shows). */
  z.object({ v: z.literal(1), t: z.literal("linked"), tab: tabInfoSchema }),
  z.object({ v: z.literal(1), t: z.literal("unlinked") }),
  /** Play / pause / seek from the person who acted; `hb` is a drift-correction heartbeat. */
  z.object({ v: z.literal(1), t: z.literal("state"), ...playbackSchema.shape }),
  /** "I just synced (or arrived): where are you?" Answered with "linked" and a non-heartbeat "state". */
  z.object({ v: z.literal(1), t: z.literal("hello") }),
]);
export type TabSyncMessage = z.infer<typeof tabSyncMessageSchema>;

export function parseTabSync(bytes: Uint8Array): TabSyncMessage | null {
  if (bytes.byteLength > 512) return null;
  try {
    const r = tabSyncMessageSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function encodeTabSync(m: TabSyncMessage): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(m));
}

/** What we show for a tab: a trimmed title, falling back to the site. */
export function tabLabel(tab: TabInfo): string {
  const t = tab.title.replace(/\s+/g, " ").trim();
  return t || tab.host;
}

/** Tab titles often end in " | Netflix" or " - Prime Video": drop the site suffix. */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s+[|\-–—]\s+(Netflix|Disney\+|Prime Video|Max|Hulu|Apple TV\+?|YouTube|Crunchyroll)\s*$/i, "")
    .trim()
    .slice(0, 120);
}

/** Sites whose player breaks if the page's <video> is seeked directly. */
export function seekNeedsPlayerApi(host: string): "netflix" | null {
  return /(^|\.)netflix\.com$/i.test(host) ? "netflix" : null;
}
