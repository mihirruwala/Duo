"use client";

import type { ProcessorOptions, Track, TrackProcessor } from "livekit-client";
import { BACKGROUNDS, type StudioConfig, type WorkerIn, type WorkerOut } from "@/shared/studio";
import { cloneAll, loadBackgrounds, loadSprites } from "./sprites";

export type StudioStats = Extract<WorkerOut, { type: "stats" }>;

/**
 * LiveKit video processor: camera frames → Studio worker → generated track. LiveKit swaps the
 * published track with replaceTrack (no renegotiation). Config changes are just messages.
 */
export class StudioProcessor implements TrackProcessor<Track.Kind.Video> {
  readonly name = "duo-studio";
  processedTrack?: MediaStreamTrack;
  private worker: Worker | null = null;
  private generator: MediaStreamTrackGenerator | null = null;

  constructor(
    private config: StudioConfig,
    private customBackground: ImageBitmap | null,
    private readonly events: {
      onStats?: (s: StudioStats) => void;
      onDegraded?: (level: number, reason: string) => void;
      onError?: (message: string) => void;
    } = {},
  ) {}

  async init(opts: ProcessorOptions<Track.Kind.Video>) {
    await this.start(opts.track);
  }

  async restart(opts: ProcessorOptions<Track.Kind.Video>) {
    this.stopPipeline();
    await this.start(opts.track);
  }

  async destroy() {
    this.stopPipeline();
  }

  update(config: StudioConfig) {
    this.config = config;
    this.post({ type: "config", config });
  }

  async setCustomBackground(bitmap: ImageBitmap | null) {
    this.customBackground = bitmap;
    const copy = bitmap ? await createImageBitmap(bitmap) : null;
    this.post({ type: "custom-background", bitmap: copy }, copy ? [copy] : []);
  }

  private post(msg: WorkerIn, transfer: Transferable[] = []) {
    this.worker?.postMessage(msg, transfer);
  }

  private async start(track: MediaStreamTrack) {
    const [sprites, backgrounds] = await Promise.all([
      loadSprites().then(cloneAll),
      loadBackgrounds(BACKGROUNDS.map((b) => b.id)).then(cloneAll),
    ]);
    const processor = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 });
    const generator = new MediaStreamTrackGenerator({ kind: "video" });
    // Keep the camera's own content hint (motion) so the encoder favours frame rate.
    generator.contentHint = track.contentHint || "motion";
    const worker = new Worker("/studio/worker.js", { name: "duo-studio" });
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === "stats") this.events.onStats?.(m);
      else if (m.type === "degraded") this.events.onDegraded?.(m.level, m.reason);
      else if (m.type === "error") this.events.onError?.(m.message);
    };
    worker.onerror = (e) => this.events.onError?.(e.message || "The effects worker crashed.");
    this.worker = worker;
    this.generator = generator;
    this.processedTrack = generator;

    const origin = window.location.origin;
    this.post(
      {
        type: "init",
        readable: processor.readable,
        writable: generator.writable,
        config: this.config,
        sprites,
        backgrounds,
        wasmBase: `${origin}/mediapipe`,
        models: { segmenter: `${origin}/models/selfie_segmenter.tflite`, face: `${origin}/models/face_landmarker.task` },
      },
      [
        processor.readable as unknown as Transferable,
        generator.writable as unknown as Transferable,
        ...Object.values(sprites),
        ...Object.values(backgrounds),
      ],
    );
    if (this.customBackground) await this.setCustomBackground(this.customBackground);
  }

  private stopPipeline() {
    this.post({ type: "stop" });
    this.worker?.terminate();
    this.worker = null;
    this.generator?.stop();
    this.generator = null;
  }
}
