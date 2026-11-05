"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the chat dock is open, shared between the dock itself and the call (which makes room for
 * it and toggles it from its control bar). Remembered per browser together with the dock's size.
 */
export const PREF_KEY = "duo.chatDock.v1";
/** Width of the chat when it's docked beside a call (desktop). */
export const DOCKED_WIDTH = 380;

type State = { open: boolean; restored: boolean };
let state: State = { open: false, restored: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readPrefs(): Record<string, unknown> {
  try {
    const p: unknown = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}");
    return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Read the saved open state once, after mount (keeps server and first client render identical). */
export function restoreDock() {
  if (state.restored) return;
  state = { open: readPrefs().open === true, restored: true };
  emit();
}

export function setDockOpen(open: boolean) {
  if (state.open === open && state.restored) return;
  state = { open, restored: true };
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), open }));
  } catch {
    // Not remembered; still applies now.
  }
  emit();
}

const SERVER: State = { open: false, restored: false };

export function useDock(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => SERVER,
  );
}
