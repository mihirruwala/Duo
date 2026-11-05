"use client";

import { useCallback, useEffect, useState } from "react";
import { useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ParticipantTile } from "./participant-tile";

/** Fullscreen for one element, as a toggle that also tracks Esc / the browser's own exit. */
export function useFullscreen(el: HTMLElement | null) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const sync = () => setActive(!!el && document.fullscreenElement === el);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [el]);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el?.requestFullscreen?.().catch(() => undefined);
  }, [el]);
  return { active, toggle };
}

export function FullscreenButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="bg-black/40 backdrop-blur"
      aria-label={active ? "Exit full screen" : "Full screen"}
      aria-pressed={active}
      data-testid="stage-fullscreen"
      onClick={onToggle}
    >
      {active ? <Minimize2 /> : <Maximize2 />}
    </Button>
  );
}

/** While the stage is fullscreen, keep your person's face in a corner (you're watching together, after all). */
export function FullscreenPartner() {
  const remote = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false }).find(
    (t) => !t.participant.isLocal,
  );
  if (!remote) return null;
  return (
    <div className="pointer-events-none absolute right-4 bottom-16 z-30 w-48 sm:w-64" data-testid="fullscreen-partner">
      <ParticipantTile trackRef={remote} variant="thumb" className="aspect-video w-full shadow-2xl" />
    </div>
  );
}
