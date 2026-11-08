"use client";

import { useEffect, useState } from "react";
import { MicOff, Moon, Sofa, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CallMode } from "@/shared/fun";

/** Under the header while you're hanging out: what it does, plus Sleep and Turn off. */
export function HangoutBanner({ onSleep, onOff }: { onSleep: () => void; onOff: () => void }) {
  return (
    <div
      role="status"
      data-testid="hangout-banner"
      className="mx-4 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-violet/30 bg-violet/10 px-4 py-2 text-sm sm:mx-6"
    >
      <Sofa className="size-4 shrink-0 text-violet" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">Hang-out mode.</span>{" "}
        <span className="text-muted-foreground">Lighter video, effects paused, screen stays on. Stay as long as you like.</span>
      </span>
      <span className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={onSleep}>
          <Moon /> Sleep
        </Button>
        <Button size="sm" variant="ghost" onClick={onOff} aria-label="Turn off hang-out mode">
          <X /> Turn off
        </Button>
      </span>
    </div>
  );
}

/** The other person's mode, in the header. */
export function PartnerModeChip({ mode, name }: { mode: CallMode; name: string }) {
  if (mode === "normal") return null;
  return (
    <span
      data-testid="partner-mode"
      data-mode={mode}
      className="flex items-center gap-1.5 rounded-full bg-violet/10 px-2.5 py-1 text-xs font-semibold text-violet"
    >
      {mode === "sleep" ? <Moon className="size-3.5" aria-hidden /> : <Sofa className="size-3.5" aria-hidden />}
      {mode === "sleep" ? `${name} is asleep` : `${name} is hanging out`}
    </span>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Sleep screen: black (cheap on OLED, dark in a dark room), a dim clock, and a reminder of what
 * is still on. Any tap or key wakes it.
 */
export function SleepScreen({
  micOn,
  partnerName,
  partnerHere,
  onWake,
}: {
  micOn: boolean;
  partnerName: string;
  partnerHere: boolean;
  onWake: () => void;
}) {
  const now = useClock();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      onWake();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onWake]);

  return (
    <button
      type="button"
      onClick={onWake}
      data-testid="sleep-screen"
      aria-label="Wake up"
      className="fixed inset-0 z-[70] flex cursor-default flex-col items-center justify-center gap-4 bg-black text-white/35 outline-none"
    >
      <span className="font-display text-6xl font-bold tabular-nums sm:text-8xl" aria-hidden>
        {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </span>
      <span className="flex items-center gap-2 text-sm">
        {micOn ? (
          <>
            <Moon className="size-4" aria-hidden /> {partnerHere ? `${partnerName} can still hear you` : "Your mic is still on"}
          </>
        ) : (
          <>
            <MicOff className="size-4" aria-hidden /> Your mic is off
          </>
        )}
      </span>
      <span className="absolute bottom-10 text-xs text-white/25">Tap anywhere to wake</span>
    </button>
  );
}
