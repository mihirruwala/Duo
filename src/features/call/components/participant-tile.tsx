"use client";

import {
  isTrackReference,
  useConnectionQualityIndicator,
  useIsMuted,
  useIsSpeaking,
  VideoTrack,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { ConnectionQuality, Track, type Participant } from "livekit-client";
import { MicOff, Signal, SignalLow, SignalMedium, WifiOff } from "lucide-react";
import { DuoAvatar } from "@/components/duo/avatar";
import { cn } from "@/lib/utils";
import { parseParticipantHue } from "@/shared/call";

/** A person's camera tile: video or avatar, name, mic state, speaking ring, connection quality. */
export function ParticipantTile({
  trackRef,
  variant = "stage",
  className,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  variant?: "stage" | "thumb";
  className?: string;
}) {
  const participant = trackRef.participant;
  const isLocal = participant.isLocal;
  const speaking = useIsSpeaking(participant);
  const camMuted = useIsMuted(trackRef);
  const micMuted = useIsMuted({
    participant,
    source: Track.Source.Microphone,
    publication: participant.getTrackPublication(Track.Source.Microphone),
  });
  const hasVideo = isTrackReference(trackRef) && !camMuted && !!trackRef.publication.track;
  const name = participant.name || "Someone";
  const micPub = participant.getTrackPublication(Track.Source.Microphone);

  return (
    <div
      data-testid={isLocal ? "tile-local" : "tile-remote"}
      data-speaking={speaking ? "" : undefined}
      data-has-video={hasVideo ? "" : undefined}
      data-audio-subscribed={!isLocal && micPub?.isSubscribed ? "" : undefined}
      className={cn(
        "relative isolate overflow-hidden bg-ink-0 ring-1 ring-white/8 transition-shadow duration-200",
        variant === "stage" ? "rounded-[1.75rem]" : "rounded-2xl",
        speaking && "ring-3 ring-mint/80",
        className,
      )}
    >
      {hasVideo ? (
        <VideoTrack trackRef={trackRef} className={cn("h-full w-full object-cover", isLocal && "-scale-x-100")} />
      ) : (
        <div className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_50%_40%,var(--duo-ink-3),var(--duo-ink-0))]">
          <DuoAvatar
            name={name}
            hue={parseParticipantHue(participant.metadata)}
            size={variant === "stage" ? "xl" : "md"}
            className={cn(speaking && "animate-pulse-ring")}
          />
        </div>
      )}

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/60 to-transparent",
          variant === "stage" ? "p-4" : "p-2",
        )}
      >
        <span
          className={cn(
            "flex min-w-0 items-center gap-1.5 rounded-full bg-black/45 font-semibold backdrop-blur",
            variant === "stage" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs",
          )}
        >
          {micMuted && <MicOff className="size-3.5 shrink-0 text-danger" aria-label="Microphone off" />}
          <span className="truncate">{isLocal ? `${name} (you)` : name}</span>
        </span>
        {!isLocal && <QualityBadge participant={participant} />}
      </div>
    </div>
  );
}

function QualityBadge({ participant }: { participant: Participant }) {
  const { quality } = useConnectionQualityIndicator({ participant });
  const map = {
    [ConnectionQuality.Excellent]: { Icon: Signal, label: "Excellent connection", tone: "text-mint" },
    [ConnectionQuality.Good]: { Icon: SignalMedium, label: "Good connection", tone: "text-mint" },
    [ConnectionQuality.Poor]: { Icon: SignalLow, label: "Poor connection", tone: "text-sun" },
    [ConnectionQuality.Lost]: { Icon: WifiOff, label: "Connection lost", tone: "text-danger" },
    [ConnectionQuality.Unknown]: null,
  } as const;
  const entry = map[quality];
  if (!entry) return null;
  const { Icon, label, tone } = entry;
  return (
    <span className={cn("ml-auto grid size-7 place-items-center rounded-full bg-black/45 backdrop-blur", tone)} title={label}>
      <Icon className="size-4" aria-label={label} />
    </span>
  );
}
