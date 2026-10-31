"use client";

/**
 * Gentle attention-getters for "your person is here": a two-note chime and, when DUO isn't the
 * tab you're looking at, a system notification. Both respect a per-browser preference and are
 * throttled per topic so a flaky connection can't spam you.
 */
const PREF_KEY = "duo.alerts.v1";
type Prefs = { sound: boolean; notify: boolean };

export function getAlertPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Partial<Prefs>;
    return { sound: p.sound !== false, notify: p.notify !== false };
  } catch {
    return { sound: true, notify: true };
  }
}

export function setAlertPrefs(p: Prefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // Not persisted.
  }
}

const lastAlert = new Map<string, number>();
const THROTTLE_MS = 10_000;

export function chime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    [523.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.16;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    // Audio unavailable (e.g. autoplay policy before any interaction); the visual cue still shows.
  }
}

export function notificationsAvailable(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return notificationsAvailable() ? Notification.permission : "unsupported";
}

/** Must be called from a click: browsers ignore permission prompts that aren't user-initiated. */
export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsAvailable()) return "unsupported";
  return Notification.requestPermission();
}

/**
 * Chime + (if DUO isn't in front) a system notification. Returns false when throttled.
 * Clicking the notification focuses DUO and opens `url`.
 */
export function alertPerson(topic: string, opts: { title: string; body: string; url?: string }): boolean {
  const now = Date.now();
  if (now - (lastAlert.get(topic) ?? 0) < THROTTLE_MS) return false;
  lastAlert.set(topic, now);
  const prefs = getAlertPrefs();
  if (prefs.sound) chime();
  const away = document.visibilityState !== "visible" || !document.hasFocus();
  if (prefs.notify && away && notificationsAvailable() && Notification.permission === "granted") {
    const n = new Notification(opts.title, { body: opts.body, icon: "/icon.svg", tag: topic });
    n.onclick = () => {
      window.focus();
      if (opts.url && window.location.pathname !== opts.url) window.location.assign(opts.url);
      n.close();
    };
  }
  return true;
}
