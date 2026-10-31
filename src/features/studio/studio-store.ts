"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_STUDIO, studioConfigSchema, type StudioConfig } from "@/shared/studio";

/**
 * The person's current look. Module-level so the pre-call preview and the call share it,
 * persisted per browser. The custom background is kept as a downscaled JPEG data URL.
 */
const KEY = "duo.studio.v1";
const BG_KEY = "duo.studio.customBg.v1";

let config: StudioConfig = DEFAULT_STUDIO;
let customBg: ImageBitmap | null = null;
let customBgRevision = 0;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const parsed = studioConfigSchema.safeParse(JSON.parse(localStorage.getItem(KEY) ?? "null"));
    if (parsed.success) config = parsed.data;
    const bg = localStorage.getItem(BG_KEY);
    if (bg) {
      void dataUrlToBitmap(bg).then((b) => {
        customBg = b;
        customBgRevision++;
        emit();
      });
    } else if (config.background.kind === "image" && config.background.id === "custom") {
      config = { ...config, background: { kind: "none" } };
    }
  } catch {
    // Storage unavailable: start with no effects.
  }
}

export function getStudioConfig(): StudioConfig {
  load();
  return config;
}

export function setStudioConfig(next: StudioConfig) {
  config = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not persisted; still applied for this session.
  }
  emit();
}

export function getCustomBackground() {
  return { bitmap: customBg, revision: customBgRevision };
}

async function dataUrlToBitmap(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return createImageBitmap(img);
}

/** Downscale an uploaded image to ≤1280×720, keep it in memory and (if it fits) in storage. */
export async function setCustomBackground(file: File): Promise<string | null> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return "Pick a PNG, JPEG, WebP or GIF image.";
  if (file.size > 15 * 1024 * 1024) return "That image is too large (15 MB max).";
  let source: ImageBitmap;
  try {
    source = await createImageBitmap(file);
  } catch {
    return "Couldn't read that image.";
  }
  const scale = Math.min(1, 1280 / source.width, 720 / source.height);
  const w = Math.round(source.width * scale);
  const h = Math.round(source.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(source, 0, 0, w, h);
  source.close();
  customBg?.close();
  customBg = await createImageBitmap(canvas);
  customBgRevision++;
  try {
    localStorage.setItem(BG_KEY, canvas.toDataURL("image/jpeg", 0.82));
  } catch {
    // Too big for storage: kept for this session only.
  }
  setStudioConfig({ ...config, background: { kind: "image", id: "custom" } });
  return null;
}

export function useStudioConfig(): StudioConfig {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getStudioConfig,
    () => DEFAULT_STUDIO,
  );
}

export function useCustomBackgroundRevision(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => customBgRevision,
    () => 0,
  );
}

export function studioSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaStreamTrackProcessor !== "undefined" &&
    typeof MediaStreamTrackGenerator !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof VideoFrame !== "undefined"
  );
}
