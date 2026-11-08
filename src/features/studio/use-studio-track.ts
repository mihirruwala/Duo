"use client";

import { useEffect, useRef, useState } from "react";
import type { LocalVideoTrack } from "livekit-client";
import { toast } from "sonner";
import { DEFAULT_STUDIO, isStudioActive } from "@/shared/studio";
import {
  getCustomBackground,
  getStudioConfig,
  setStudioConfig,
  studioSupported,
  useCustomBackgroundRevision,
  useStudioConfig,
} from "./studio-store";
import { StudioProcessor, type StudioStats } from "./studio-processor";

/**
 * Keeps a LocalVideoTrack in sync with the current Studio look: attaches the processor when
 * something is on, sends config updates while running, and removes it entirely when everything
 * is off (zero cost when idle). Works for the pre-call preview and the published camera alike.
 * `paused` (hang-out mode) takes the processor off without forgetting the look.
 */
export function useStudioTrack(track: LocalVideoTrack | null | undefined, paused = false) {
  const config = useStudioConfig();
  const bgRevision = useCustomBackgroundRevision();
  const [stats, setStats] = useState<StudioStats | null>(null);
  const processorRef = useRef<StudioProcessor | null>(null);
  const busy = useRef<Promise<void>>(Promise.resolve());
  const active = isStudioActive(config) && !paused;

  // Attach / detach.
  useEffect(() => {
    if (!track || !studioSupported()) return;
    let cancelled = false;
    busy.current = busy.current.then(async () => {
      if (cancelled) return;
      const current = track.getProcessor();
      if (active && !(current instanceof StudioProcessor)) {
        const p = new StudioProcessor(getStudioConfig(), getCustomBackground().bitmap, {
          onStats: setStats,
          onDegraded: (level, reason) => {
            if (reason === "overload") {
              // Last resort: keep cheap colour effects, drop the heavy ones.
              setStudioConfig({ ...getStudioConfig(), background: { kind: "none" }, face: "none" });
              toast.warning(
                "Your device is struggling, so backgrounds and face filters were turned off to keep the call smooth.",
              );
            } else if (level === 1) {
              toast.info("Effects quality lowered slightly to keep your video smooth.");
            }
          },
          onError: (message) => toast.error(`Effects stopped: ${message}`),
        });
        try {
          await track.setProcessor(p);
          processorRef.current = p;
        } catch (err) {
          toast.error(`Couldn't start effects: ${(err as Error).message}`);
          setStudioConfig(DEFAULT_STUDIO);
        }
      } else if (!active && current instanceof StudioProcessor) {
        await track.stopProcessor();
        processorRef.current = null;
        setStats(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [track, active]);

  // Live updates without touching the track.
  useEffect(() => {
    processorRef.current?.update(config);
  }, [config]);
  useEffect(() => {
    if (bgRevision) void processorRef.current?.setCustomBackground(getCustomBackground().bitmap);
  }, [bgRevision]);

  return { config, stats: active ? stats : null };
}
