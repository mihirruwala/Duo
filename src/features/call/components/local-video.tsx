"use client";

import { useEffect, useRef } from "react";
import type { LocalVideoTrack } from "livekit-client";
import { cn } from "@/lib/utils";

/** Renders a local preview track, mirrored like a mirror (only locally; others see it unflipped). */
export function LocalVideo({
  track,
  className,
  mirror = true,
}: {
  track: LocalVideoTrack;
  className?: string;
  mirror?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <video
      ref={ref}
      muted
      playsInline
      autoPlay
      data-testid="local-preview"
      className={cn("h-full w-full object-cover", mirror && "-scale-x-100", className)}
    />
  );
}
