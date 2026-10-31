"use client";

/* eslint-disable @next/next/no-img-element -- remote GIPHY media */
import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { gifSearchResponseSchema, type Gif } from "@/shared/chat";

export function GifPicker({ onPick }: { onPick: (gif: Gif) => void }) {
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  async function load(q: string, offset: number) {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gifs?q=${encodeURIComponent(q)}&offset=${offset}`);
      const body: unknown = await res.json().catch(() => null);
      if (id !== reqId.current) return;
      if (!res.ok) {
        const msg = body && typeof body === "object" && "message" in body ? String(body.message) : "Couldn't load GIFs.";
        setError(msg);
        return;
      }
      const parsed = gifSearchResponseSchema.parse(body);
      setGifs((prev) => (offset === 0 ? parsed.gifs : [...prev, ...parsed.gifs]));
      setNext(parsed.nextOffset);
    } catch {
      if (id === reqId.current) setError("Couldn't load GIFs.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void load(query.trim(), 0), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="flex h-96 w-80 flex-col gap-2">
      <label className="relative">
        <span className="sr-only">Search GIFs</span>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GIPHY"
          maxLength={80}
          className="h-10 w-full rounded-xl border border-input bg-ink-1 pr-3 pl-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="gif-search"
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl" data-testid="gif-results">
        {error ? (
          <p className="p-4 text-center text-sm text-muted-foreground" role="alert">
            {error}
          </p>
        ) : (
          <div className="columns-2 gap-1.5">
            {gifs.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onPick(g)}
                className="mb-1.5 block w-full overflow-hidden rounded-lg bg-ink-3 focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Send GIF: ${g.title || "untitled"}`}
              >
                <img
                  src={g.preview}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="block w-full"
                  style={{ aspectRatio: `${g.width} / ${g.height}` }}
                />
              </button>
            ))}
          </div>
        )}
        {loading && (
          <div className="grid place-items-center py-4">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && !error && next !== null && gifs.length > 0 && (
          <button
            type="button"
            onClick={() => void load(query.trim(), next)}
            className="w-full rounded-lg py-2 text-sm text-muted-foreground hover:bg-ink-3"
          >
            Load more
          </button>
        )}
        {!loading && !error && gifs.length === 0 && (
          <p className="p-4 text-center text-sm text-muted-foreground">No GIFs found.</p>
        )}
      </div>
      <p className="text-right text-[0.65rem] tracking-wide text-muted-foreground uppercase">Powered by GIPHY</p>
    </div>
  );
}
