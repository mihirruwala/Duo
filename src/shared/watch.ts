import { z } from "zod";

/** Watch Together: synced YouTube playback inside the call, over LiveKit data messages. */
export const WATCH_TOPIC = "duo.watch";

/**
 * Track name of a "Watch mode" screen share: a tab with a show or film, captured for motion (30 fps,
 * high bitrate) with its sound. Viewers use it to label the share and offer a volume control.
 */
export const WATCH_SHARE_TRACK = "duo-watch";

const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const seconds = z
  .number()
  .finite()
  .min(0)
  .max(60 * 60 * 24);

export const watchMessageSchema = z.discriminatedUnion("t", [
  /** Start (or switch to) a video. Also the reply to "hello", so a late joiner catches up. */
  z.object({
    v: z.literal(1),
    t: z.literal("open"),
    id: z.uuid(),
    /** The session this one replaces ("change video"), so it's never mistaken for a simultaneous start. */
    prev: z.uuid().optional(),
    videoId,
    at: seconds,
    playing: z.boolean(),
  }),
  /** Play / pause / seek. `hb` marks a drift-correction heartbeat from whoever acted last. */
  z.object({
    v: z.literal(1),
    t: z.literal("state"),
    id: z.uuid(),
    at: seconds,
    playing: z.boolean(),
    hb: z.boolean().optional(),
  }),
  z.object({ v: z.literal(1), t: z.literal("close"), id: z.uuid() }),
  /** "I just arrived: is something playing?" */
  z.object({ v: z.literal(1), t: z.literal("hello") }),
]);
export type WatchMessage = z.infer<typeof watchMessageSchema>;

export function parseWatch(bytes: Uint8Array): WatchMessage | null {
  if (bytes.byteLength > 512) return null;
  try {
    const r = watchMessageSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function encodeWatch(m: WatchMessage): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(m));
}

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/** "1h2m3s", "90s", "90" → seconds. */
function parseStart(t: string | null): number {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || !m[0]) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * Pull the video id (and start time) out of anything people paste: watch links, youtu.be,
 * shorts, live, embed, or a bare 11-character id. Returns null for anything else.
 */
export function parseYouTube(input: string): { videoId: string; start: number } | null {
  const text = input.trim();
  if (videoId.safeParse(text).success) return { videoId: text, start: 0 };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (YT_HOSTS.has(host)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = /^\/(?:shorts|live|embed|v)\/([^/?#]+)/.exec(url.pathname);
      id = m?.[1] ?? null;
    }
  }
  if (!id || !videoId.safeParse(id).success) return null;
  return { videoId: id, start: parseStart(url.searchParams.get("t") ?? url.searchParams.get("start")) };
}

/** First YouTube link in a piece of text (e.g. a shared-list item), if any. */
export function findYouTube(text: string): { videoId: string; start: number } | null {
  for (const word of text.split(/\s+/)) {
    if (!/youtu/i.test(word)) continue;
    const r = parseYouTube(word);
    if (r) return r;
  }
  return null;
}
