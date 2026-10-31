"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocalParticipant, useTracks, VideoTrack, isTrackReference } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Mic, MicOff, Video, VideoOff } from "lucide-react";
import { DuoAvatar } from "@/components/duo/avatar";
import { useControl } from "@/features/control/control-provider";
import { parseParticipantHue } from "@/shared/call";

export function pipSupported() {
  return typeof window !== "undefined" && !!window.documentPictureInPicture;
}

/**
 * An always-on-top mini window (Document Picture-in-Picture) that stays visible while you're in
 * another tab, which is exactly when you've shared a tab for remote control. It shows your person
 * and keeps Revoke (or Approve/Deny) one click away.
 */
export function useCallPip() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);

  const open = useCallback(async () => {
    const api = window.documentPictureInPicture;
    if (!api) return false;
    if (api.window) return true;
    try {
      // Must run inside a user gesture (a click), or Chrome refuses.
      const win = await api.requestWindow({ width: 320, height: 300 });
      // Carry over DUO's styles and font variables.
      for (const node of Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))) {
        win.document.head.appendChild(node.cloneNode(true));
      }
      win.document.documentElement.className = document.documentElement.className;
      win.document.title = "DUO";
      win.document.body.className = "bg-background text-foreground m-0";
      win.addEventListener("pagehide", () => setPipWindow(null), { once: true });
      setPipWindow(win);
      return true;
    } catch {
      return false;
    }
  }, []);

  const close = useCallback(() => {
    window.documentPictureInPicture?.window?.close();
    setPipWindow(null);
  }, []);

  // Leaving the call closes the mini window.
  useEffect(() => () => window.documentPictureInPicture?.window?.close(), []);

  return { pipWindow, open, close };
}

export function CallPip({ pipWindow }: { pipWindow: Window | null }) {
  if (!pipWindow) return null;
  return createPortal(<PipContent />, pipWindow.document.body);
}

function PipContent() {
  const c = useControl();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const cams = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  const remote = cams.find((t) => !t.participant.isLocal);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ownerActive = c.control.phase === "active" && c.control.role === "owner";
  const left = c.control.phase === "active" ? Math.max(0, Math.round((c.control.expiresAt - now) / 1000)) : 0;

  return (
    <div className="flex h-dvh flex-col gap-2 p-2 font-sans" data-testid="call-pip">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-ink-0">
        {remote && isTrackReference(remote) && !remote.publication.isMuted ? (
          <VideoTrack trackRef={remote} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center">
            {remote ? (
              <DuoAvatar name={remote.participant.name || "?"} hue={parseParticipantHue(remote.participant.metadata)} size="lg" />
            ) : (
              <span className="text-sm text-muted-foreground">Waiting for your person…</span>
            )}
          </div>
        )}
        {remote && (
          <span className="absolute bottom-2 left-2 rounded-full bg-black/50 px-2 py-0.5 text-xs font-semibold">
            {remote.participant.name}
          </span>
        )}
      </div>

      {ownerActive ? (
        <div className="flex items-center gap-2 rounded-2xl bg-danger px-3 py-2 text-ink-0" role="alert">
          <span className="min-w-0 flex-1 text-xs leading-tight font-bold">
            {c.control.phase === "active" ? c.control.peerName : ""} is controlling
            <span className="block font-semibold tabular-nums opacity-80">
              {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left
            </span>
          </span>
          <button
            type="button"
            onClick={() => c.revoke()}
            className="rounded-xl bg-ink-0 px-3 py-1.5 text-sm font-bold text-cream"
            data-testid="pip-revoke"
          >
            Revoke
          </button>
        </div>
      ) : c.control.phase === "incoming" ? (
        <div className="flex items-center gap-2 rounded-2xl border border-coral/50 bg-coral/15 px-3 py-2" role="alert">
          <span className="min-w-0 flex-1 text-xs font-bold">{c.control.controllerName} wants control</span>
          <button
            type="button"
            onClick={() => void c.deny()}
            className="rounded-xl px-2 py-1.5 text-xs font-semibold hover:bg-ink-3"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => void c.approve()}
            className="rounded-xl bg-coral px-3 py-1.5 text-xs font-bold text-ink-0"
            data-testid="pip-approve"
          >
            Approve
          </button>
        </div>
      ) : null}

      <div className="flex items-center justify-center gap-2">
        <PipButton
          label={isMicrophoneEnabled ? "Mute" : "Unmute"}
          off={!isMicrophoneEnabled}
          onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        >
          {isMicrophoneEnabled ? <Mic /> : <MicOff />}
        </PipButton>
        <PipButton
          label={isCameraEnabled ? "Camera off" : "Camera on"}
          off={!isCameraEnabled}
          onClick={() => void localParticipant.setCameraEnabled(!isCameraEnabled)}
        >
          {isCameraEnabled ? <Video /> : <VideoOff />}
        </PipButton>
      </div>
    </div>
  );
}

function PipButton({
  label,
  off,
  onClick,
  children,
}: {
  label: string;
  off: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid size-10 place-items-center rounded-xl [&_svg]:size-5 ${off ? "bg-danger/90 text-ink-0" : "bg-ink-3 text-foreground hover:bg-ink-4"}`}
    >
      {children}
    </button>
  );
}
