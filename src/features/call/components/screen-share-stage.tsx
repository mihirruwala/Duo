"use client";

import { useRef } from "react";
import { VideoTrack, type TrackReference } from "@livekit/components-react";
import { Maximize2, MonitorUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Large shared-screen view. The local share shows a placeholder to avoid an infinite mirror. */
export function ScreenShareStage({ trackRef, onStopLocal }: { trackRef: TrackReference; onStopLocal: () => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const isLocal = trackRef.participant.isLocal;
  const name = trackRef.participant.name || "Someone";

  return (
    <div
      ref={stageRef}
      data-testid={isLocal ? "share-local" : "share-remote"}
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[1.75rem] bg-ink-0 ring-1 ring-white/8"
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent p-3 sm:p-4">
        <span className="flex items-center gap-1.5 rounded-full bg-danger px-2.5 py-1 text-xs font-extrabold tracking-wider text-ink-0">
          <span className="size-1.5 animate-pulse rounded-full bg-ink-0" aria-hidden /> LIVE
        </span>
        <span className="truncate text-sm font-semibold" role="status">
          {isLocal ? "You are sharing your screen" : `${name} is sharing their screen`}
        </span>
        {!isLocal && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto bg-black/40 backdrop-blur"
            aria-label="Full screen"
            onClick={() => void stageRef.current?.requestFullscreen?.()}
          >
            <Maximize2 />
          </Button>
        )}
      </div>

      {isLocal ? (
        <div className="grid flex-1 place-items-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <span className="grid size-16 place-items-center rounded-3xl bg-ink-3 text-coral">
              <MonitorUp className="size-8" aria-hidden />
            </span>
            <p className="text-lg font-bold">Your screen is live for the other person</p>
            <p className="text-sm text-muted-foreground">
              They see what you shared. Stop here or from the browser&apos;s own bar.
            </p>
            <Button variant="danger" onClick={onStopLocal}>
              <X /> Stop sharing
            </Button>
          </div>
        </div>
      ) : (
        <VideoTrack trackRef={trackRef} className="h-full w-full bg-black object-contain" />
      )}
    </div>
  );
}
