"use client";

import { useState } from "react";
import { Clapperboard, Play, Popcorn, Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseYouTube } from "@/shared/watch";

export type WatchSuggestion = { id: string; label: string; videoId: string; start: number };

/** Paste a YouTube link (or pick one saved in a shared list) to start watching together. */
export function WatchDialog({
  open,
  onOpenChange,
  onStart,
  suggestions = [],
  changing = false,
  onShareTab,
  onSyncTab,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (videoId: string, start: number) => void;
  suggestions?: WatchSuggestion[];
  changing?: boolean;
  /** For anything that isn't on YouTube: share the tab it plays in (Watch mode). */
  onShareTab?: () => void;
  /** Netflix etc. on each person's own account, kept in step by the extension. */
  onSyncTab?: () => void;
}) {
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);

  function start(videoId: string, at: number) {
    onStart(videoId, at);
    setLink("");
    setError(null);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="watch-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clapperboard className="size-5 text-coral" aria-hidden /> {changing ? "Change video" : "Watch together"}
          </DialogTitle>
          <DialogDescription>
            Paste a YouTube link. You each play it on your own device, in sync: either of you can pause, play or skip.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = parseYouTube(link);
            if (!parsed)
              return setError(
                onShareTab
                  ? "That doesn't look like a YouTube link. For other sites, open the show in a tab and share it instead."
                  : "That doesn't look like a YouTube link.",
              );
            start(parsed.videoId, parsed.start);
          }}
        >
          <Label htmlFor="watch-link">YouTube link</Label>
          <Input
            id="watch-link"
            autoFocus
            value={link}
            placeholder="https://youtu.be/…"
            onChange={(e) => {
              setLink(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "watch-link-error" : undefined}
          />
          {error && (
            <p id="watch-link-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted-foreground">From your lists</span>
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {suggestions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => start(s.videoId, s.start)}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-ink-3"
                    >
                      <Play className="size-4 shrink-0 text-coral" aria-hidden />
                      <span className="truncate">{s.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {onSyncTab && (
            <div className="mt-3 flex items-center gap-3 rounded-2xl bg-ink-1/70 p-3 text-sm">
              <Tv className="size-5 shrink-0 text-mint" aria-hidden />
              <span className="flex-1 text-muted-foreground">
                Netflix, Disney+ or another site? Each watch on your own account, kept in sync.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  onSyncTab();
                }}
              >
                Sync a show
              </Button>
            </div>
          )}
          {onShareTab && (
            <div className="mt-3 flex items-center gap-3 rounded-2xl bg-ink-1/70 p-3 text-sm">
              <Popcorn className="size-5 shrink-0 text-coral" aria-hidden />
              <span className="flex-1 text-muted-foreground">Watching on another site? Share that tab, with its sound.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  onShareTab();
                }}
              >
                Share a tab
              </Button>
            </div>
          )}
          <DialogFooter className="mt-3">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={!link.trim()}>
              <Play /> {changing ? "Play this instead" : "Start"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
