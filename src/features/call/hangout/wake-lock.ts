/**
 * Keep the screen from locking (Screen Wake Lock API). The browser drops the lock whenever the
 * page is hidden, so it's taken again when the page comes back. Returns a cleanup function.
 * Where the API is missing (older Safari) this does nothing.
 */
export function keepScreenAwake(): () => void {
  const wl = typeof navigator !== "undefined" ? navigator.wakeLock : undefined;
  if (!wl) return () => {};
  let sentinel: WakeLockSentinel | null = null;
  let stopped = false;

  const acquire = async () => {
    if (stopped || document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
    try {
      const s = await wl.request("screen");
      if (stopped) void s.release();
      else sentinel = s;
    } catch {
      // Battery saver, or not allowed right now. The call still works.
    }
  };
  const onVisible = () => void acquire();
  document.addEventListener("visibilitychange", onVisible);
  void acquire();

  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisible);
    void sentinel?.release().catch(() => undefined);
    sentinel = null;
  };
}
