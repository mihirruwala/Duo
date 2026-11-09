"use client";

import { useSyncExternalStore } from "react";

/** Which sheet is up over a room on a phone: the call setup, or the room's info. */
export type PhoneSheet = "call" | "info" | null;

let sheet: PhoneSheet = null;
const listeners = new Set<() => void>();

export function setPhoneSheet(next: PhoneSheet) {
  if (next === sheet) return;
  sheet = next;
  listeners.forEach((l) => l());
}

export function usePhoneSheet(): PhoneSheet {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => sheet,
    () => null,
  );
}
