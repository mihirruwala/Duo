"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";

/** Short-lived links to private attachments. Re-signed automatically before they expire. */
const TTL_SECONDS = 300;
const cache = new Map<string, { url: string; expiresAt: number }>();
const inflight = new Map<string, Promise<string | null>>();

async function sign(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.expiresAt - Date.now() > 30_000) return hit.url;
  const pending = inflight.get(path);
  if (pending) return pending;
  const p = getBrowserClient()
    .storage.from("attachments")
    .createSignedUrl(path, TTL_SECONDS)
    .then(({ data }) => {
      if (!data?.signedUrl) return null;
      cache.set(path, { url: data.signedUrl, expiresAt: Date.now() + TTL_SECONDS * 1000 });
      return data.signedUrl;
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

export function useSignedUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (path ? (cache.get(path)?.url ?? null) : null));
  useEffect(() => {
    if (!path) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const next = await sign(path);
      if (!alive) return;
      setUrl(next);
      timer = setTimeout(refresh, (TTL_SECONDS - 60) * 1000);
    };
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [path]);
  return url;
}

/** One-off signed link that forces a download with the original file name. */
export async function downloadUrl(path: string, fileName: string): Promise<string | null> {
  const { data } = await getBrowserClient().storage.from("attachments").createSignedUrl(path, 60, { download: fileName });
  return data?.signedUrl ?? null;
}
