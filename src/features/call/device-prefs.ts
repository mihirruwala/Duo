"use client";

/** Per-browser device choices. A convenience only: everything works without storage. */
export type DevicePrefs = {
  cameraId?: string;
  micId?: string;
  speakerId?: string;
  cameraOn: boolean;
  micOn: boolean;
};

const KEY = "duo.devicePrefs.v1";
const DEFAULTS: DevicePrefs = { cameraOn: true, micOn: true };

export function loadDevicePrefs(): DevicePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DevicePrefs>;
    return {
      cameraId: typeof parsed.cameraId === "string" ? parsed.cameraId : undefined,
      micId: typeof parsed.micId === "string" ? parsed.micId : undefined,
      speakerId: typeof parsed.speakerId === "string" ? parsed.speakerId : undefined,
      cameraOn: parsed.cameraOn !== false,
      micOn: parsed.micOn !== false,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveDevicePrefs(prefs: DevicePrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable; preferences just won't persist.
  }
}
