"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw } from "lucide-react";
import { haptic } from "@/lib/haptics";

const TRIGGER = 72;
const MAX = 110;

/**
 * Pull down from the top of the page to refresh (touch screens). The page itself doesn't bounce on
 * phones, so the pull is drawn here: the content follows the finger with some resistance, a spinner
 * shows how far, and letting go past the line re-fetches the server data.
 */
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, startRefresh] = useTransition();
  const start = useRef<{ y: number; armed: boolean } | null>(null);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (window.scrollY > 0 || e.touches.length !== 1 || document.querySelector('[role="dialog"]')) return;
      start.current = { y: e.touches[0]!.clientY, armed: false };
    };
    const onMove = (e: TouchEvent) => {
      const s = start.current;
      if (!s) return;
      const dy = e.touches[0]!.clientY - s.y;
      if (dy <= 0 || window.scrollY > 0) {
        setPull(0);
        return;
      }
      const d = Math.min(MAX, dy * 0.5);
      setPull(d);
      if (d >= TRIGGER && !s.armed) {
        s.armed = true;
        haptic("light");
      } else if (d < TRIGGER) s.armed = false;
    };
    const onEnd = () => {
      const s = start.current;
      start.current = null;
      setPull(0);
      if (s?.armed) startRefresh(() => router.refresh());
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [router]);

  const shown = refreshing ? 48 : pull;
  return (
    <>
      <div
        aria-hidden={!refreshing}
        role={refreshing ? "status" : undefined}
        className="pointer-events-none flex justify-center overflow-hidden text-muted-foreground transition-[height] duration-200 sm:hidden"
        style={{ height: shown, transitionDuration: pull ? "0ms" : undefined }}
      >
        <span className="self-end pb-3">
          {refreshing ? (
            <Loader2 className="size-5 animate-spin" aria-label="Refreshing" />
          ) : (
            <RotateCw
              className="size-5 transition-opacity"
              style={{ opacity: Math.min(1, pull / TRIGGER), transform: `rotate(${(pull / TRIGGER) * 270}deg)` }}
            />
          )}
        </span>
      </div>
      {children}
    </>
  );
}
