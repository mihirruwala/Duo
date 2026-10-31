import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, isSameOrigin } from "@/lib/http";
import { log } from "@/lib/log";
import { hitRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/supabase/server";
import { GIPHY_MEDIA, type Gif } from "@/shared/chat";

const querySchema = z.object({
  q: z.string().trim().max(80).default(""),
  offset: z.coerce.number().int().min(0).max(4000).default(0),
});

const PAGE = 24;

type GiphyImage = { url?: string; webp?: string; width?: string; height?: string };
type GiphyItem = { id: string; title?: string; images?: Record<string, GiphyImage | undefined> };

function toGif(item: GiphyItem): Gif | null {
  const full = item.images?.fixed_height;
  const small = item.images?.fixed_width_small ?? item.images?.fixed_height_small ?? full;
  const url = full?.webp ?? full?.url;
  const preview = small?.webp ?? small?.url ?? url;
  if (!url || !preview || !GIPHY_MEDIA.test(url) || !GIPHY_MEDIA.test(preview)) return null;
  // Strip GIPHY's tracking query params; the path alone serves the media.
  const clean = (u: string) => u.split("?")[0]!;
  return {
    id: item.id.slice(0, 64),
    title: (item.title ?? "").slice(0, 200),
    url: clean(url),
    preview: clean(preview),
    width: Number(full?.width) || 200,
    height: Number(full?.height) || 200,
  };
}

/**
 * GIPHY proxy: the API key never leaves the server. Requires a session, rate-limited per user.
 * Search when `q` is set, trending otherwise.
 */
export async function GET(request: NextRequest) {
  if (!isSameOrigin(request)) return apiError(403, "forbidden", "Cross-site request refused.");
  const key = process.env.GIPHY_API_KEY;
  if (!key) return apiError(503, "gifs_disabled", "GIF search isn't set up.");

  const { user } = await getCurrentUser();
  if (!user) return apiError(401, "not_authenticated", "Please sign in first.");

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return apiError(400, "invalid_query", "Invalid search.");
  if (!(await hitRateLimit(RATE_LIMITS.gifSearch, user.id))) return apiError(429, "rate_limited", "Slow down a little.");

  const { q, offset } = parsed.data;
  const endpoint = new URL(`https://api.giphy.com/v1/gifs/${q ? "search" : "trending"}`);
  endpoint.searchParams.set("api_key", key);
  endpoint.searchParams.set("limit", String(PAGE));
  endpoint.searchParams.set("offset", String(offset));
  endpoint.searchParams.set("rating", "pg-13");
  endpoint.searchParams.set("bundle", "messaging_non_clips");
  if (q) endpoint.searchParams.set("q", q);

  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!res.ok) throw new Error(`giphy ${res.status}`);
    const body = (await res.json()) as {
      data?: GiphyItem[];
      pagination?: { total_count?: number; count?: number; offset?: number };
    };
    const gifs = (body.data ?? []).map(toGif).filter((g): g is Gif => g !== null);
    const p = body.pagination;
    const next = p && (p.offset ?? 0) + (p.count ?? 0) < (p.total_count ?? 0) ? (p.offset ?? 0) + (p.count ?? 0) : null;
    return Response.json({ gifs, nextOffset: next }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (err) {
    log.warn("gifs.upstream_failed", { err: err as Error });
    return apiError(502, "gifs_unavailable", "GIFs are taking a nap. Try again soon.");
  }
}
