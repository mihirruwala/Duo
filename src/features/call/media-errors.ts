/** Human explanations for getUserMedia / getDisplayMedia failures. */
export function describeMediaError(err: unknown, device: "camera" | "microphone" | "screen"): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return device === "screen"
        ? "Screen sharing was cancelled or blocked."
        : inIOSApp()
          ? `DUO doesn't have permission to use your ${device}. Turn it on in Settings → DUO, then try again.`
          : `DUO doesn't have permission to use your ${device}. Allow it from the camera icon in the address bar, then try again.`;
    case "NotFoundError":
    case "OverconstrainedError":
      return `No ${device} found. Plug one in or pick another device.`;
    case "NotReadableError":
    case "AbortError":
      return `Your ${device} is busy in another app. Close that app and try again.`;
    default:
      return `Couldn't start your ${device}.`;
  }
}

/** The DUO iPhone app (its web view adds "DUOiOS" to the user agent). */
export function inIOSApp(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("DUOiOS");
}

export function isUserCancel(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotAllowedError";
}
