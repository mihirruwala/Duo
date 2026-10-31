"use client";

import { useEffect, useState } from "react";
import { Hand, Loader2, MousePointer2, Puzzle, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EMERGENCY_SHORTCUT } from "@/shared/control";
import { emergencyShortcut, retryExtension, useExtensionStatus } from "../extension-bridge";
import { useControl } from "../control-provider";

function useShortcutLabel() {
  // Read on every render: the extension reports the real (possibly user-customized) shortcut after connecting.
  useExtensionStatus();
  const fromExtension = emergencyShortcut();
  if (fromExtension) return fromExtension;
  return typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent) ? EMERGENCY_SHORTCUT.mac : EMERGENCY_SHORTCUT.other;
}

function useCountdown(expiresAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return "";
  const s = Math.max(0, Math.round((expiresAt - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Owner-side: approval prompt, the always-visible "control active" banner, and setup dialogs. */
export function OwnerControlLayer() {
  const c = useControl();
  const shortcut = useShortcutLabel();
  const ownerActive = c.control.phase === "active" && c.control.role === "owner";
  const left = useCountdown(ownerActive && c.control.phase === "active" ? c.control.expiresAt : null);

  return (
    <>
      {(ownerActive || c.control.phase === "starting") && (
        <div
          role="alert"
          data-testid="control-active-banner"
          className="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-danger px-4 py-2 text-sm font-semibold text-ink-0 shadow-lg"
        >
          <span className="flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-ink-0" aria-hidden />
            {c.control.phase === "starting"
              ? "Starting remote control…"
              : `Remote control active: ${c.control.phase === "active" ? c.control.peerName : ""} is controlling “${c.sharedTabTitle || "your shared tab"}”`}
          </span>
          {ownerActive && <span className="tabular-nums opacity-80">{left} left</span>}
          <span className="opacity-80">
            Stop anytime: <kbd className="rounded bg-ink-0/20 px-1.5">{shortcut}</kbd>
          </span>
          <Button
            size="sm"
            className="bg-ink-0 text-cream hover:bg-ink-1"
            onClick={() => c.revoke()}
            data-testid="revoke-control"
          >
            Revoke now
          </Button>
        </div>
      )}

      <Dialog open={c.control.phase === "incoming"} onOpenChange={(o) => !o && void c.deny()}>
        <DialogContent className="z-[65] rounded-[1.75rem] sm:max-w-md" data-testid="control-request-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-2xl">
              <MousePointer2 className="size-6 text-coral" /> Hand over control?
            </DialogTitle>
            <DialogDescription>
              {c.control.phase === "incoming" ? c.control.controllerName : "Your person"} wants to click, scroll and type in “
              {c.sharedTabTitle || "your shared tab"}”.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
            <li>• Only that one tab. Never other tabs, apps or browser settings.</li>
            <li>• Paste is blocked so your clipboard stays private, and so are browser shortcuts.</li>
            <li>
              • Stop instantly with <kbd className="rounded bg-ink-3 px-1.5 text-foreground">{shortcut}</kbd> (works even outside
              Chrome) or the Revoke button.
            </li>
            <li>
              • Chrome will show a “DUO Control started debugging this browser” bar. That&apos;s expected: it&apos;s how the input
              is delivered.
            </li>
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => void c.deny()}>
              Deny
            </Button>
            <Button variant="brand" onClick={() => void c.approve()} data-testid="approve-control">
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={c.awaitingTabPick} onOpenChange={(o) => !o && c.cancelTabPick()}>
        <DialogContent className="z-[65] rounded-[1.75rem] sm:max-w-md">
          {c.extension === "connected" ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-2xl">Pick the tab to share</DialogTitle>
                <DialogDescription>
                  Remote control works on a single tab you choose, shared through the DUO extension.
                </DialogDescription>
              </DialogHeader>
              <ol className="flex flex-col gap-3 text-sm">
                <Step n={1}>Switch to the tab you want your person to see and control.</Step>
                <Step n={2}>
                  Click the <Puzzle className="inline size-4" /> extensions icon, then <strong>DUO Control</strong>. Pin it for
                  next time.
                </Step>
                <Step n={3}>
                  Press <strong>Share this tab with DUO</strong>. You&apos;ll be back here automatically.
                </Step>
              </ol>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Waiting for the extension…
              </p>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-2xl">Install DUO Control</DialogTitle>
                <DialogDescription>
                  Handing over control needs a small Chrome extension on your computer (the person sharing).
                </DialogDescription>
              </DialogHeader>
              <ol className="flex flex-col gap-3 text-sm">
                <Step n={1}>
                  Open <code className="rounded bg-ink-3 px-1">chrome://extensions</code> and turn on{" "}
                  <strong>Developer mode</strong>.
                </Step>
                <Step n={2}>
                  Click <strong>Load unpacked</strong> and choose the{" "}
                  <code className="rounded bg-ink-3 px-1">extension/dist</code> folder (build it with{" "}
                  <code className="rounded bg-ink-3 px-1">npm run ext:build</code>).
                </Step>
                <Step n={3}>Come back here and press Check again.</Step>
              </ol>
              <p className="text-sm text-muted-foreground">
                Plain screen sharing works without it; it just can&apos;t be controlled.
              </p>
              <DialogFooter>
                <Button variant="ghost" onClick={c.cancelTabPick}>
                  Not now
                </Button>
                <Button onClick={retryExtension}>Check again</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-coral text-xs font-bold text-ink-0">{n}</span>
      <span>{children}</span>
    </li>
  );
}

/** Controller-side bar on the shared screen: request → waiting → in control. */
export function ControllerBar({ ownerName }: { ownerName: string }) {
  const c = useControl();
  const active = c.control.phase === "active" && c.control.role === "controller";
  const left = useCountdown(active && c.control.phase === "active" ? c.control.expiresAt : null);

  return (
    <div className="absolute inset-x-0 bottom-3 z-30 flex justify-center px-3" data-testid="controller-bar">
      <div className="glass flex items-center gap-2 rounded-2xl p-1.5 pl-3 text-sm shadow-xl">
        {c.control.phase === "requesting" ? (
          <>
            <Loader2 className="size-4 animate-spin text-coral" />
            <span>Waiting for {ownerName} to approve…</span>
            <Button size="sm" variant="ghost" onClick={c.cancelRequest}>
              <X /> Cancel
            </Button>
          </>
        ) : active ? (
          <>
            <span className="size-2 animate-pulse rounded-full bg-danger" aria-hidden />
            <span className="font-semibold" role="status">
              You&apos;re controlling {ownerName}&apos;s tab
            </span>
            <span className="text-muted-foreground tabular-nums">{left}</span>
            <Button size="sm" variant="secondary" onClick={c.release} data-testid="release-control">
              <Hand /> Hand back
            </Button>
          </>
        ) : (
          <>
            <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">{ownerName} can let you click and type here</span>
            <Button size="sm" onClick={() => void c.requestControl()} data-testid="request-control">
              <MousePointer2 /> Request control
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
