"use client";

import { useSyncExternalStore } from "react";

/** Same breakpoint as Tailwind's `sm`: below it, DUO uses its phone layouts. */
export const PHONE_QUERY = "(width < 40rem)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * true on phone-sized screens, false on larger ones, null before hydration (the server can't know).
 * Use CSS (`max-sm:` / `sm:`) where you can; this is for structure that CSS can't swap, like not
 * starting the camera preview on a phone until the call sheet opens.
 */
export function usePhone(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => null,
  );
}
