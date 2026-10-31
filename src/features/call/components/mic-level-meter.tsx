"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const BARS = 12;

/**
 * Live input level from a MediaStreamTrack (Web Audio analyser). Updates the DOM directly
 * on each animation frame instead of through React state, so it costs no re-renders.
 */
export function MicLevelMeter({ track, className }: { track: MediaStreamTrack | null | undefined; className?: string }) {
  const barsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bars = barsRef.current ? (Array.from(barsRef.current.children) as HTMLElement[]) : [];
    const paint = (level: number) => {
      const lit = Math.round(level * BARS);
      bars.forEach((bar, i) => bar.toggleAttribute("data-lit", i < lit));
      barsRef.current?.setAttribute("data-level", level.toFixed(2));
      barsRef.current?.setAttribute("aria-valuenow", level.toFixed(2));
    };
    if (!track || track.readyState === "ended") {
      paint(0);
      return;
    }

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let raf = 0;
    let smoothed = 0;

    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      // Map roughly -60 dBFS..-10 dBFS to 0..1.
      const db = 20 * Math.log10(rms || 1e-8);
      const level = Math.min(1, Math.max(0, (db + 60) / 50));
      smoothed = level > smoothed ? level : smoothed * 0.85 + level * 0.15;
      paint(smoothed);
      raf = requestAnimationFrame(tick);
    };
    void ctx.resume().then(() => (raf = requestAnimationFrame(tick)));

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close();
    };
  }, [track]);

  return (
    <div
      ref={barsRef}
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={0}
      data-testid="mic-level"
      className={cn("flex h-5 items-end gap-[3px]", className)}
    >
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          className="w-1.5 rounded-full bg-ink-4 transition-colors duration-75 data-lit:bg-mint [&:nth-child(n+9)[data-lit]]:bg-sun [&:nth-child(n+11)[data-lit]]:bg-coral"
          style={{ height: `${35 + (i / BARS) * 65}%` }}
        />
      ))}
    </div>
  );
}
