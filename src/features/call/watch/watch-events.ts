"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useMaybeLists } from "@/features/lists/lists-provider";
import { findYouTube } from "@/shared/watch";
import type { WatchSuggestion } from "./watch-dialog";

/**
 * A tiny bridge between the shared lists (in the chat dock) and the call: lists can ask the call
 * to "watch this now", and know whether a call is open to ask.
 */
export const WATCH_EVENT = "duo:watch";
export type WatchRequest = { videoId: string; start: number };

export function requestWatch(req: WatchRequest) {
  window.dispatchEvent(new CustomEvent<WatchRequest>(WATCH_EVENT, { detail: req }));
}

let callOpen = false;
const listeners = new Set<() => void>();
function setCallOpen(open: boolean) {
  callOpen = open;
  listeners.forEach((l) => l());
}

/** Mounted by the call layout: while it's mounted, "Watch now" buttons appear in lists. */
export function useAnnounceCall() {
  useEffect(() => {
    setCallOpen(true);
    return () => setCallOpen(false);
  }, []);
}

export function useCallOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => callOpen,
    () => false,
  );
}

/** Unchecked YouTube links saved in the room's lists, for the Watch Together dialog. */
export function useWatchSuggestions(): WatchSuggestion[] {
  const lists = useMaybeLists();
  return useMemo(() => {
    if (!lists) return [];
    const out: WatchSuggestion[] = [];
    for (const item of lists.items) {
      if (item.done) continue;
      const yt = findYouTube(item.body);
      if (!yt) continue;
      const label = item.body.replace(/\S*youtu\S*/gi, "").trim() || "YouTube video";
      out.push({ id: item.id, label, videoId: yt.videoId, start: yt.start });
      if (out.length >= 20) break;
    }
    return out;
  }, [lists]);
}
