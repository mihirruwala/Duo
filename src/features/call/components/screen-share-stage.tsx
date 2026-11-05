"use client";

import { useState } from "react";
import { VideoTrack, type TrackReference } from "@livekit/components-react";
import { Track, type Participant, type RemoteParticipant } from "livekit-client";
import { Slider } from "@/components/ui/slider";
import { Maximize2, MonitorUp, PictureInPicture2, Volume1, Volume2, VolumeX, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FullscreenButton, FullscreenPartner, useFullscreen } from "./fullscreen";
import { Button } from "@/components/ui/button";

/** Large shared-screen view. The local share shows a placeholder to avoid an infinite mirror. */
export function ScreenShareStage({
  trackRef,
  onStopLocal,
  localTitle,
  renderOverlay,
  compact = false,
  onActivate,
  style,
  watchMode = false,
  partnerName,
  onPopOut,
}: {
  trackRef: TrackReference;
  onStopLocal: () => void;
  /** Set when the local share is a tab shared through the DUO extension. */
  localTitle?: string | null;
  /** Extra layers over the shared video (remote-control surface and bar). */
  renderOverlay?: (videoContainer: HTMLElement | null) => React.ReactNode;
  /** Small tile while a person is pinned to the big spot. */
  compact?: boolean;
  /** Compact only: click to bring the share back to the big spot. */
  onActivate?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
  /** A Watch-mode share (a show playing in a tab, with sound). */
  watchMode?: boolean;
  partnerName?: string | null;
  /** Sharer only: open the always-on-top window with their person's face before switching tabs. */
  onPopOut?: () => void;
}) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const fullscreen = useFullscreen(stage);
  const isLocal = trackRef.participant.isLocal;
  const name = trackRef.participant.name || "Someone";

  return (
    <div
      ref={setStage}
      data-testid={isLocal ? "share-local" : "share-remote"}
      data-slot={compact ? "thumb" : "main"}
      style={style}
      className={cn(
        "relative flex min-h-0 flex-col overflow-hidden bg-ink-0 ring-1 ring-white/8",
        compact ? "aspect-video w-full rounded-2xl" : "h-full rounded-[1.75rem]",
      )}
    >
      {compact && (
        <button
          type="button"
          onClick={onActivate}
          aria-label={isLocal ? "Make your shared screen big" : `Make ${name}'s screen big`}
          data-testid="share-activate"
          className="absolute inset-0 z-20 flex items-end justify-start bg-gradient-to-t from-black/60 to-transparent p-2 text-left"
        >
          <span className="flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur">
            <span className="size-1.5 animate-pulse rounded-full bg-danger" aria-hidden />
            {isLocal ? "Your screen" : `${name}'s screen`}
            <Maximize2 className="size-3" aria-hidden />
          </span>
        </button>
      )}
      <div
        className={cn(
          "absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent p-3 sm:p-4",
          compact && "hidden",
        )}
      >
        <span className="flex items-center gap-1.5 rounded-full bg-danger px-2.5 py-1 text-xs font-extrabold tracking-wider text-ink-0">
          <span className="size-1.5 animate-pulse rounded-full bg-ink-0" aria-hidden /> LIVE
        </span>
        <span className="truncate text-sm font-semibold" role="status">
          {isLocal
            ? localTitle
              ? `You are sharing “${localTitle}”`
              : "You are sharing your screen"
            : watchMode
              ? `${name} is sharing a show 🍿`
              : `${name} is sharing their screen`}
        </span>
        {!isLocal && watchMode && <ShowVolume participant={trackRef.participant} />}
        {!isLocal && (
          <span className={watchMode ? "" : "ml-auto"}>
            <FullscreenButton active={fullscreen.active} onToggle={fullscreen.toggle} />
          </span>
        )}
      </div>

      {isLocal && compact ? (
        <div className="grid flex-1 place-items-center bg-ink-1">
          <MonitorUp className="size-7 text-coral" aria-hidden />
        </div>
      ) : isLocal && watchMode ? (
        <div className="grid flex-1 place-items-center p-6" data-testid="watch-share-local">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <span className="grid size-16 place-items-center rounded-3xl bg-ink-3 text-3xl" aria-hidden>
              🍿
            </span>
            <p className="text-lg font-bold">Your show is live for {partnerName ?? "your person"}</p>
            <ol className="flex flex-col gap-1 text-left text-sm text-muted-foreground">
              {onPopOut && <li>1. Pop out {partnerName ?? "their"}’s face so you can see them over the show.</li>}
              <li>
                {onPopOut ? "2." : "1."} Switch to the show’s tab and press play. Pause and skip there; they see and hear what you
                do.
              </li>
              <li>{onPopOut ? "3." : "2."} Headphones stop your mic from sending the sound twice.</li>
            </ol>
            <div className="flex flex-wrap justify-center gap-2">
              {onPopOut && (
                <Button variant="brand" onClick={onPopOut} data-testid="watch-pop-out">
                  <PictureInPicture2 /> Pop out {partnerName ?? "their face"}
                </Button>
              )}
              <Button variant="danger" onClick={onStopLocal}>
                <X /> Stop sharing
              </Button>
            </div>
          </div>
        </div>
      ) : isLocal ? (
        <div className="grid flex-1 place-items-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <span className="grid size-16 place-items-center rounded-3xl bg-ink-3 text-coral">
              <MonitorUp className="size-8" aria-hidden />
            </span>
            <p className="text-lg font-bold">
              {localTitle ? `“${localTitle}” is live for the other person` : "Your screen is live for the other person"}
            </p>
            <p className="text-sm text-muted-foreground">
              {localTitle
                ? "They can ask to control this tab. Nothing happens until you approve."
                : "They see what you shared. Stop here or from the browser's own bar."}
            </p>
            <Button variant="danger" onClick={onStopLocal}>
              <X /> Stop sharing
            </Button>
          </div>
        </div>
      ) : (
        <VideoTrack trackRef={trackRef} className="h-full w-full bg-black object-contain" />
      )}
      {!compact && renderOverlay?.(stage)}
      {fullscreen.active && <FullscreenPartner />}
    </div>
  );
}

/** Viewer-side volume for the show's sound, separate from your person's voice. */
function ShowVolume({ participant }: { participant: Participant }) {
  const [volume, setVolume] = useState(1);
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <span className="ml-auto flex items-center gap-2 rounded-full bg-black/40 px-3 py-1 backdrop-blur" title="Show volume">
      <Icon className="size-4 shrink-0" aria-hidden />
      <Slider
        className="w-24"
        min={0}
        max={1}
        step={0.05}
        value={[volume]}
        aria-label="Show volume"
        data-testid="show-volume"
        onValueChange={([v = 1]) => {
          setVolume(v);
          (participant as RemoteParticipant).setVolume?.(v, Track.Source.ScreenShareAudio);
        }}
      />
    </span>
  );
}
