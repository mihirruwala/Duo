/**
 * A light physical tap for touch interactions. In the iPhone app it goes to the Taptic Engine
 * (WKWebView has no Vibration API, so the app exposes a tiny message handler); on Android it
 * uses navigator.vibrate; elsewhere it does nothing.
 */
export type HapticKind = "light" | "medium" | "selection" | "success" | "warning";

type Bridge = { postMessage: (kind: HapticKind) => void };

export function haptic(kind: HapticKind = "light") {
  if (typeof window === "undefined") return;
  const bridge = (window as unknown as { webkit?: { messageHandlers?: { duoHaptic?: Bridge } } }).webkit?.messageHandlers
    ?.duoHaptic;
  if (bridge) {
    try {
      bridge.postMessage(kind);
    } catch {
      // The app went away mid-call; nothing to do.
    }
    return;
  }
  const pattern = { light: 8, selection: 5, medium: 15, success: [10, 40, 12], warning: [20, 60, 20] }[kind];
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Some browsers throw without a recent user gesture.
  }
}
