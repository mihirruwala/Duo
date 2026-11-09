"use client";

import { Loader2, MousePointerClick, Puzzle, RefreshCw, Tv, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { retryExtension } from "@/features/control/extension-bridge";
import { extensionStoreUrl } from "@/shared/extension-id";
import { tabLabel } from "@/shared/tab-sync";
import type { TabSync } from "./use-tab-sync";

const storeUrl = extensionStoreUrl();

/** Under the header while either person has a synced tab. */
export function TabSyncBanner({ sync, onStart }: { sync: TabSync; onStart: () => void }) {
  const { mine, theirs } = sync;
  if (!mine && !theirs) return null;
  return (
    <div
      role="status"
      data-testid="tab-sync-banner"
      className="mx-4 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-mint/30 bg-mint/10 px-4 py-2 text-sm sm:mx-6"
    >
      <Tv className="size-4 shrink-0 text-mint" aria-hidden />
      <span className="min-w-0 flex-1">
        {mine && theirs ? (
          <>
            <span className="font-semibold">Watching in sync.</span>{" "}
            <span className="text-muted-foreground">
              You: <span data-testid="sync-mine">{tabLabel(mine.tab)}</span> · {theirs.name}:{" "}
              <span data-testid="sync-theirs">{tabLabel(theirs.tab)}</span>. Play, pause and skip in your own tab.
            </span>
          </>
        ) : mine ? (
          <>
            <span className="font-semibold">Your tab is synced</span>{" "}
            <span className="text-muted-foreground">
              (<span data-testid="sync-mine">{tabLabel(mine.tab)}</span>). Waiting for your person to sync theirs.
            </span>
          </>
        ) : (
          theirs && (
            <>
              <span className="font-semibold">
                {theirs.name} is watching <span data-testid="sync-theirs">{tabLabel(theirs.tab)}</span> in sync.
              </span>{" "}
              <span className="text-muted-foreground">
                Open it on {theirs.tab.host} in another tab, on your own account, and sync it too.
              </span>
            </>
          )
        )}
        {mine && !mine.video && (
          <span className="block text-sun" data-testid="sync-no-video">
            No video in your synced tab yet: start the show there.
          </span>
        )}
        {mine?.needsGesture && (
          <span className="block text-sun" data-testid="sync-needs-click">
            Chrome wants one click on play in your show tab before it will follow along.
          </span>
        )}
      </span>
      <span className="flex gap-2">
        {mine ? (
          <Button size="sm" variant="ghost" onClick={sync.stop}>
            <X /> Stop syncing
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={onStart}>
            <Tv /> Sync my tab
          </Button>
        )}
      </span>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-mint text-xs font-bold text-ink-0">{n}</span>
      <span className="flex flex-col">{children}</span>
    </li>
  );
}

/** How to pick the tab, or how to get (or update) the extension first. */
export function TabSyncDialog({ sync }: { sync: TabSync }) {
  const ready = sync.extension === "connected" && !sync.needsUpdate;
  return (
    <Dialog open={sync.picking} onOpenChange={(o) => !o && sync.cancelPick()}>
      <DialogContent className="z-[65] rounded-[1.75rem] sm:max-w-md" data-testid="tab-sync-dialog">
        {ready ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl">Sync a show</DialogTitle>
              <DialogDescription>
                Netflix, Disney+, Prime Video or any site with a video. You each watch on your own account, in your own tab, and
                DUO keeps play, pause and skipping in step.
              </DialogDescription>
            </DialogHeader>
            <ol className="flex flex-col gap-3 text-sm">
              <Step n={1}>Open the show in another tab. Your person opens the same one.</Step>
              <Step n={2}>
                Click the <Puzzle className="inline size-4" /> extensions icon, then <strong>DUO Control</strong>.
              </Step>
              <Step n={3}>
                Press <strong>Sync this tab&apos;s video with DUO</strong>.
              </Step>
            </ol>
            <p className="text-sm text-muted-foreground">
              DUO only sees the tab&apos;s title and site, never what&apos;s on it. Pop out keeps your person&apos;s face on top
              while you watch.
            </p>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Waiting for the extension…
            </p>
          </>
        ) : sync.needsUpdate ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl">Update DUO Control</DialogTitle>
              <DialogDescription>Syncing a show needs DUO Control 1.1 or newer.</DialogDescription>
            </DialogHeader>
            <ol className="flex flex-col gap-3 text-sm">
              <Step n={1}>
                Open <code className="rounded bg-ink-3 px-1">chrome://extensions</code>, turn on Developer mode and press{" "}
                <strong>Update</strong>. (Chrome also updates it by itself within a few hours.)
              </Step>
              <Step n={2}>Come back here and press Check again.</Step>
            </ol>
            <DialogFooter>
              <Button variant="ghost" onClick={sync.cancelPick}>
                Not now
              </Button>
              <Button onClick={retryExtension}>
                <RefreshCw /> Check again
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl">Get DUO Control</DialogTitle>
              <DialogDescription>
                Syncing a show on any site needs the small DUO extension in Chrome, on both computers.
              </DialogDescription>
            </DialogHeader>
            <ol className="flex flex-col gap-3 text-sm">
              {storeUrl ? (
                <Step n={1}>
                  Add DUO Control from the Chrome Web Store.
                  <Button asChild className="mt-2 w-fit" variant="brand">
                    <a href={storeUrl} target="_blank" rel="noopener noreferrer">
                      <Puzzle /> Add to Chrome
                    </a>
                  </Button>
                </Step>
              ) : (
                <Step n={1}>
                  Load <code className="rounded bg-ink-3 px-1">extension/dist</code> unpacked from{" "}
                  <code className="rounded bg-ink-3 px-1">chrome://extensions</code> (build it with{" "}
                  <code className="rounded bg-ink-3 px-1">npm run ext:build</code>).
                </Step>
              )}
              <Step n={2}>Come back here and press Check again.</Step>
            </ol>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <MousePointerClick className="size-4" /> Without it, Watch mode (sharing your tab) still works.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={sync.cancelPick}>
                Not now
              </Button>
              <Button onClick={retryExtension}>
                <RefreshCw /> Check again
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
