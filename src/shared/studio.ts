/**
 * DUO Studio catalog + config. Shared by the UI, the LiveKit processor and the worker.
 * Everything listed here is implemented; nothing decorative.
 */
import { z } from "zod";

export const BACKGROUNDS = [
  { id: "cozy-room", label: "Cozy room" },
  { id: "spaceship", label: "Spaceship" },
  { id: "anime-sky", label: "Anime sky" },
  { id: "tropical", label: "Tropical escape" },
] as const;
export type BackgroundId = (typeof BACKGROUNDS)[number]["id"];

export const EFFECTS = [
  { id: "bw", label: "Black & white" },
  { id: "vintage", label: "Vintage film" },
  { id: "vhs", label: "VHS" },
  { id: "retro", label: "Retro webcam" },
  { id: "pixelate", label: "Pixelate" },
  { id: "night", label: "Night vision" },
  { id: "invert", label: "Invert" },
] as const;
export type EffectId = (typeof EFFECTS)[number]["id"];

export const FACE_FILTERS = [
  { id: "dog", label: "Puppy", category: "animals" },
  { id: "cat", label: "Kitty", category: "animals" },
  { id: "sunglasses", label: "Cool shades", category: "funny" },
  { id: "big-glasses", label: "Big eyes", category: "funny" },
  { id: "crown", label: "Crown", category: "cartoon" },
  { id: "hearts", label: "Floating hearts", category: "cartoon" },
  { id: "confetti", label: "Confetti", category: "cartoon" },
] as const;
export type FaceFilterId = (typeof FACE_FILTERS)[number]["id"];

/** GPU effect ids passed to the shader (0 = none). Order is part of the shader contract. */
export const EFFECT_INDEX: Record<EffectId | "none", number> = {
  none: 0,
  bw: 1,
  vintage: 2,
  vhs: 3,
  retro: 4,
  pixelate: 5,
  night: 6,
  invert: 7,
};

export const studioConfigSchema = z.object({
  background: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("blur"), strength: z.number().min(0.2).max(1) }),
    z.object({
      kind: z.literal("image"),
      id: z.union([z.enum(BACKGROUNDS.map((b) => b.id) as [BackgroundId, ...BackgroundId[]]), z.literal("custom")]),
    }),
  ]),
  effect: z.union([z.literal("none"), z.enum(EFFECTS.map((e) => e.id) as [EffectId, ...EffectId[]])]),
  face: z.union([z.literal("none"), z.enum(FACE_FILTERS.map((f) => f.id) as [FaceFilterId, ...FaceFilterId[]])]),
});
export type StudioConfig = z.infer<typeof studioConfigSchema>;

export const DEFAULT_STUDIO: StudioConfig = { background: { kind: "none" }, effect: "none", face: "none" };

export function isStudioActive(c: StudioConfig): boolean {
  return c.background.kind !== "none" || c.effect !== "none" || c.face !== "none";
}

/** What the worker needs to compute (so idle features cost nothing). */
export function studioNeeds(c: StudioConfig) {
  return { segmentation: c.background.kind !== "none", landmarks: c.face !== "none", effect: EFFECT_INDEX[c.effect] };
}

// ── Messages between the processor (main thread) and the worker ──────────────

export type WorkerIn =
  | {
      type: "init";
      readable: ReadableStream<VideoFrame>;
      writable: WritableStream<VideoFrame>;
      config: StudioConfig;
      sprites: Record<string, ImageBitmap>;
      backgrounds: Record<string, ImageBitmap>;
      wasmBase: string;
      models: { segmenter: string; face: string };
    }
  | { type: "config"; config: StudioConfig }
  | { type: "custom-background"; bitmap: ImageBitmap | null }
  | { type: "stop" };

export type WorkerOut =
  | { type: "ready" }
  | {
      type: "stats";
      fps: number;
      ms: number;
      level: number;
      segMs: number;
      faceMs: number;
      faces: number;
      /** Which MediaPipe delegate each model ended up on ("-" = not loaded). */
      delegate: { segmenter: "GPU" | "CPU" | "-"; face: "GPU" | "CPU" | "-" };
    }
  | { type: "degraded"; level: number; reason: string }
  | { type: "error"; message: string };

/**
 * Adaptive quality. Level 0 = best. Each step trades fidelity for time; the last one asks the UI
 * to switch heavy features off.
 */
export const QUALITY_LEVELS = [
  { segW: 256, segH: 144, landmarkEvery: 1, segEvery: 1 },
  { segW: 192, segH: 108, landmarkEvery: 2, segEvery: 1 },
  { segW: 160, segH: 90, landmarkEvery: 2, segEvery: 2 },
] as const;
export const TARGET_FRAME_MS = 33;
