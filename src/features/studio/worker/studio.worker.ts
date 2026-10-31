/**
 * DUO Studio worker: reads camera frames, runs MediaPipe (segmentation / face landmarks only when
 * the current look needs them), composites on the GPU and writes processed frames back. Classic
 * worker (see scripts/prepare-studio.mjs). Nothing here touches the main thread.
 */
import { FaceLandmarker, FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import { QUALITY_LEVELS, studioNeeds, TARGET_FRAME_MS, type StudioConfig, type WorkerIn, type WorkerOut } from "@/shared/studio";
import { drawFaceFilter, poseFrom, smoothPose, type FacePose } from "./face-overlay";
import { Renderer } from "./renderer";

declare const self: DedicatedWorkerGlobalScope;
const post = (m: WorkerOut) => self.postMessage(m);

let config: StudioConfig;
let running = false;
let sprites: Record<string, ImageBitmap> = {};
let backgrounds: Record<string, ImageBitmap> = {};
let customBg: ImageBitmap | null = null;
let wasmBase = "";
let models = { segmenter: "", face: "" };

let renderer: Renderer | null = null;
let glCanvas: OffscreenCanvas | null = null;
let outCanvas: OffscreenCanvas | null = null;
let outCtx: OffscreenCanvasRenderingContext2D | null = null;
let segCanvas: OffscreenCanvas | null = null;
let segCtx: OffscreenCanvasRenderingContext2D | null = null;
let faceCanvas: OffscreenCanvas | null = null;
let faceCtx: OffscreenCanvasRenderingContext2D | null = null;

let segmenter: ImageSegmenter | null = null;
let landmarker: FaceLandmarker | null = null;
let loading: Promise<unknown> | null = null;
const delegates: { segmenter: "GPU" | "CPU" | "-"; face: "GPU" | "CPU" | "-" } = { segmenter: "-", face: "-" };
/** Frames to ignore in the quality governor (shader compile, model warm-up). */
let warmup = 45;
let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;

let mask: Uint8Array | null = null;
let maskPrev: Float32Array | null = null;
let pose: FacePose | null = null;
let poseSeenAt = 0;
let appliedBg = "";

// Adaptive quality
let level = 0;
let frameNo = 0;
let lastTs = -1;
const recentMs: number[] = [];
let overSince = 0;
let underSince = 0;
let statFrames = 0;
let statStart = performance.now();
let segMsAcc = 0;
let faceMsAcc = 0;
let facesSeen = 0;

async function vision() {
  fileset ??= await FilesetResolver.forVisionTasks(wasmBase);
  return fileset;
}

/** GPU delegate first (fast); fall back to CPU if the GPU path isn't available. */
async function ensureModels(needSeg: boolean, needFace: boolean) {
  if (loading) return;
  if ((!needSeg || segmenter) && (!needFace || landmarker)) return;
  loading = (async () => {
    const fs = await vision();
    for (const delegate of ["GPU", "CPU"] as const) {
      try {
        if (needSeg && !segmenter) {
          segmenter = await ImageSegmenter.createFromOptions(fs, {
            baseOptions: { modelAssetPath: models.segmenter, delegate },
            runningMode: "VIDEO",
            outputConfidenceMasks: true,
            outputCategoryMask: false,
            canvas: new OffscreenCanvas(1, 1),
          });
          delegates.segmenter = delegate;
          warmup = 45;
        }
        if (needFace && !landmarker) {
          landmarker = await FaceLandmarker.createFromOptions(fs, {
            baseOptions: { modelAssetPath: models.face, delegate },
            runningMode: "VIDEO",
            numFaces: 1,
            canvas: new OffscreenCanvas(1, 1),
          });
          delegates.face = delegate;
          warmup = 45;
        }
        return;
      } catch (err) {
        if (delegate === "CPU") throw err;
      }
    }
  })()
    .catch((err) => post({ type: "error", message: `Couldn't load face/background models: ${(err as Error).message}` }))
    .finally(() => {
      loading = null;
    });
}

function canvas2d(w: number, h: number, c: OffscreenCanvas | null): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] {
  const canvas = c && c.width === w && c.height === h ? c : new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: false }) as OffscreenCanvasRenderingContext2D;
  return [canvas, ctx];
}

function segment(frame: VideoFrame, ts: number) {
  const q = QUALITY_LEVELS[level]!;
  if (!segmenter || frameNo % q.segEvery !== 0) return;
  [segCanvas, segCtx] = canvas2d(q.segW, q.segH, segCanvas);
  segCtx.drawImage(frame, 0, 0, q.segW, q.segH);
  const t0 = performance.now();
  segmenter.segmentForVideo(segCanvas, ts, (result) => {
    const m = result.confidenceMasks?.[0];
    if (!m) return;
    const data = m.getAsFloat32Array();
    // Temporal smoothing kills flicker at the edges.
    if (!maskPrev || maskPrev.length !== data.length) maskPrev = new Float32Array(data);
    if (!mask || mask.length !== data.length) mask = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const v = maskPrev[i]! * 0.4 + data[i]! * 0.6;
      maskPrev[i] = v;
      mask[i] = v * 255;
    }
    renderer?.setMask(mask, m.width, m.height);
  });
  segMsAcc += performance.now() - t0;
}

function detectFace(frame: VideoFrame, ts: number, w: number, h: number) {
  const q = QUALITY_LEVELS[level]!;
  if (!landmarker || frameNo % q.landmarkEvery !== 0) return;
  const fw = 480;
  const fh = Math.round((480 * h) / w);
  [faceCanvas, faceCtx] = canvas2d(fw, fh, faceCanvas);
  faceCtx.drawImage(frame, 0, 0, fw, fh);
  const t0 = performance.now();
  const res = landmarker.detectForVideo(faceCanvas, ts);
  faceMsAcc += performance.now() - t0;
  const lm = res.faceLandmarks?.[0];
  if (lm) {
    const next = poseFrom(lm, w, h);
    if (next) {
      pose = smoothPose(pose, next);
      poseSeenAt = ts;
      facesSeen++;
    }
  } else if (ts - poseSeenAt > 400) {
    pose = null;
  }
}

function adapt(ms: number, now: number) {
  if (warmup > 0) {
    warmup--;
    return;
  }
  recentMs.push(ms);
  if (recentMs.length > 30) recentMs.shift();
  const avg = recentMs.reduce((a, b) => a + b, 0) / recentMs.length;
  if (avg > TARGET_FRAME_MS) {
    overSince ||= now;
    underSince = 0;
    if (now - overSince > 2500) {
      overSince = now;
      if (level < QUALITY_LEVELS.length - 1) {
        level++;
        post({ type: "degraded", level, reason: "slow" });
      } else if (avg > TARGET_FRAME_MS * 1.5) {
        post({ type: "degraded", level, reason: "overload" });
      }
    }
  } else if (avg < TARGET_FRAME_MS * 0.6) {
    underSince ||= now;
    overSince = 0;
    if (level > 0 && now - underSince > 8000) {
      underSince = now;
      level--;
    }
  } else {
    overSince = 0;
    underSince = 0;
  }
}

function processFrame(frame: VideoFrame): VideoFrame {
  const needs = studioNeeds(config);
  const w = frame.displayWidth;
  const h = frame.displayHeight;
  // Timestamps for MediaPipe VIDEO mode must strictly increase (ms).
  const ts = Math.max(lastTs + 1, Math.round(frame.timestamp / 1000));
  lastTs = ts;
  frameNo++;

  void ensureModels(needs.segmentation, needs.landmarks);
  if (needs.segmentation) segment(frame, ts);
  if (needs.landmarks) detectFace(frame, ts, w, h);

  glCanvas ??= new OffscreenCanvas(w, h);
  renderer ??= new Renderer(glCanvas);
  const bgKey = config.background.kind === "image" ? config.background.id : "";
  if (bgKey && bgKey !== appliedBg) {
    renderer.setBackground(bgKey === "custom" ? customBg : (backgrounds[bgKey] ?? null));
    appliedBg = bgKey;
  }
  const haveMask = mask !== null && (needs.segmentation ? !!segmenter : false);
  const mode = !haveMask
    ? 0
    : config.background.kind === "blur"
      ? 1
      : config.background.kind === "image" && (bgKey !== "custom" || customBg)
        ? 2
        : 0;
  const time = performance.now() / 1000;
  renderer.render(frame, {
    mode,
    blurStrength: config.background.kind === "blur" ? config.background.strength : 0,
    effect: needs.effect,
    time,
  });

  let source: OffscreenCanvas = glCanvas;
  if (config.face !== "none" && pose) {
    [outCanvas, outCtx] = canvas2d(w, h, outCanvas);
    outCtx.drawImage(glCanvas, 0, 0);
    drawFaceFilter(outCtx, config.face, pose, sprites, time);
    source = outCanvas;
  }
  return new VideoFrame(source, { timestamp: frame.timestamp, alpha: "discard" });
}

async function pump(readable: ReadableStream<VideoFrame>, writable: WritableStream<VideoFrame>) {
  const reader = readable.getReader();
  const writer = writable.getWriter();
  running = true;
  post({ type: "ready" });
  while (running) {
    const { value: frame, done } = await reader.read();
    if (done || !frame) break;
    const t0 = performance.now();
    let out: VideoFrame | null = null;
    try {
      out = processFrame(frame);
    } catch (err) {
      post({ type: "error", message: (err as Error).message });
    }
    const ms = performance.now() - t0;
    try {
      if (out) {
        frame.close();
        await writer.write(out);
      } else {
        await writer.write(frame); // pass the original through rather than freezing the video
      }
    } catch {
      break; // generator track stopped
    }
    statFrames++;
    const now = performance.now();
    adapt(ms, now);
    if (now - statStart >= 1000) {
      const avg = recentMs.reduce((a, b) => a + b, 0) / Math.max(1, recentMs.length);
      post({
        type: "stats",
        fps: Math.round((statFrames * 1000) / (now - statStart)),
        ms: Math.round(avg * 10) / 10,
        level,
        segMs: Math.round((segMsAcc / Math.max(1, statFrames)) * 10) / 10,
        faceMs: Math.round((faceMsAcc / Math.max(1, statFrames)) * 10) / 10,
        faces: facesSeen,
        delegate: { ...delegates },
      });
      statFrames = 0;
      segMsAcc = 0;
      faceMsAcc = 0;
      facesSeen = 0;
      statStart = now;
    }
  }
  await reader.cancel().catch(() => undefined);
  await writer.close().catch(() => undefined);
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init":
      config = msg.config;
      sprites = msg.sprites;
      backgrounds = msg.backgrounds;
      wasmBase = msg.wasmBase;
      models = msg.models;
      void pump(msg.readable, msg.writable).catch((err) => post({ type: "error", message: (err as Error).message }));
      return;
    case "config":
      config = msg.config;
      warmup = Math.max(warmup, 15);
      if (config.face === "none") pose = null;
      return;
    case "custom-background":
      customBg?.close();
      customBg = msg.bitmap;
      if (appliedBg === "custom") appliedBg = ""; // re-upload on next frame
      return;
    case "stop":
      running = false;
      segmenter?.close();
      landmarker?.close();
      segmenter = null;
      landmarker = null;
      return;
  }
};
