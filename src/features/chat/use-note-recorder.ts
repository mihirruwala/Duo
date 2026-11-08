"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MAX_VIDEO_MS, MAX_VOICE_MS, NOTE_TYPES, WAVEFORM_BARS } from "@/shared/chat";
import type { RecordedNote } from "./chat-provider";

type Kind = "voice" | "video";

// MP4 (AAC audio, H.264 video) first: it plays everywhere, including Safari on iPhone, which has patchy
// WebM support. Chrome and Safari record it; WebM is the fallback for browsers that can't (Firefox).
const CANDIDATES: Record<Kind, string[]> = {
  voice: ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"],
  video: [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ],
};

/** The first container this browser can record that DUO also accepts. */
export function pickMimeType(kind: Kind, isSupported: (t: string) => boolean = (t) => MediaRecorder.isTypeSupported(t)) {
  for (const t of CANDIDATES[kind]) {
    if (isSupported(t) && t.split(";")[0]! in NOTE_TYPES) return t;
  }
  return null;
}

/** Squash per-tick loudness samples into a fixed number of bars, scaled 0–100. */
export function toWaveform(samples: number[], bars = WAVEFORM_BARS): number[] {
  if (samples.length === 0) return [];
  const out: number[] = [];
  const per = samples.length / bars;
  for (let b = 0; b < bars; b++) {
    const from = Math.floor(b * per);
    const to = Math.max(from + 1, Math.floor((b + 1) * per));
    const slice = samples.slice(from, Math.min(to, samples.length));
    out.push(slice.length ? Math.max(...slice) : 0);
  }
  const peak = Math.max(...out, 0.0001);
  return out.map((v) => Math.round(Math.min(1, v / peak) * 100));
}

export type RecorderState =
  | { phase: "idle" }
  | { phase: "starting"; kind: Kind }
  | { phase: "recording"; kind: Kind; startedAt: number; stream: MediaStream };

/**
 * Records a voice or video note with MediaRecorder. Tracks are always stopped when recording
 * ends or the component unmounts, so the mic/camera light never stays on.
 */
export function useNoteRecorder(opts: { onAutoStop: (note: RecordedNote) => void }) {
  /** Called with the note when the time limit stops a recording by itself. */
  const autoStopped = useRef(opts.onAutoStop);
  useLayoutEffect(() => {
    autoStopped.current = opts.onAutoStop;
  });
  const [state, setState] = useState<RecorderState>({ phase: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const rec = useRef<{
    recorder: MediaRecorder;
    chunks: Blob[];
    stream: MediaStream;
    samples: number[];
    audio: AudioContext | null;
    timer: ReturnType<typeof setInterval>;
    startedAt: number;
    mime: string;
    kind: Kind;
    done: ((note: RecordedNote | null) => void) | null;
    discard: boolean;
  } | null>(null);

  const cleanup = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.audio?.close().catch(() => undefined);
    rec.current = null;
    setState({ phase: "idle" });
    setElapsed(0);
    setLevel(0);
  }, []);

  useEffect(
    () => () => {
      const r = rec.current;
      if (!r) return;
      r.discard = true;
      if (r.recorder.state !== "inactive") r.recorder.stop();
      cleanup();
    },
    [cleanup],
  );

  /** Ends the recording; resolves with the note (or null if it was too short / cancelled). */
  const finish = useCallback((discard: boolean) => {
    const r = rec.current;
    if (!r) return Promise.resolve(null);
    r.discard = discard;
    return new Promise<RecordedNote | null>((resolve) => {
      r.done = resolve;
      if (r.recorder.state !== "inactive") r.recorder.stop();
      else resolve(null);
    });
  }, []);

  const start = useCallback(
    async (kind: Kind): Promise<string | null> => {
      if (rec.current) return null;
      if (typeof MediaRecorder === "undefined") return "This browser can't record notes.";
      const mime = pickMimeType(kind);
      if (!mime) return "This browser can't record in a format DUO accepts.";
      setState({ phase: "starting", kind });
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: kind === "video" ? { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: "user" } : false,
        });
      } catch (err) {
        setState({ phase: "idle" });
        const name = (err as DOMException).name;
        if (name === "NotAllowedError")
          return `Allow ${kind === "video" ? "camera and microphone" : "microphone"} access to record.`;
        if (name === "NotFoundError") return kind === "video" ? "No camera or microphone found." : "No microphone found.";
        return "Couldn't start recording.";
      }

      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        ...(kind === "video" ? { videoBitsPerSecond: 1_000_000, audioBitsPerSecond: 64_000 } : { audioBitsPerSecond: 48_000 }),
      });
      const samples: number[] = [];
      let audio: AudioContext | null = null;
      let analyser: AnalyserNode | null = null;
      try {
        audio = new AudioContext();
        analyser = audio.createAnalyser();
        analyser.fftSize = 1024;
        audio.createMediaStreamSource(stream).connect(analyser);
      } catch {
        audio = null;
      }
      const buf = new Float32Array(1024);
      const startedAt = performance.now();
      const max = kind === "video" ? MAX_VIDEO_MS : MAX_VOICE_MS;
      const timer = setInterval(() => {
        const ms = performance.now() - startedAt;
        setElapsed(ms);
        if (analyser) {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          const rms = Math.sqrt(sum / buf.length);
          samples.push(rms);
          setLevel(Math.min(1, rms * 6));
        }
        if (ms >= max && recorder.state === "recording") recorder.stop();
      }, 100);

      const chunks: Blob[] = [];
      rec.current = { recorder, chunks, stream, samples, audio, timer, startedAt, mime, kind, done: null, discard: false };
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      recorder.onstop = () => {
        const r = rec.current;
        if (!r) return;
        const durationMs = Math.min(performance.now() - r.startedAt, max);
        const done = r.done;
        const discard = r.discard;
        cleanup();
        if (discard || durationMs < 500 || chunks.length === 0) return done?.(null);
        const base = r.mime.split(";")[0]!;
        const ext = NOTE_TYPES[base]?.ext ?? "webm";
        const file = new File(chunks, `${kind === "voice" ? "voice" : "video"}-note-${Date.now()}.${ext}`, { type: base });
        const note: RecordedNote = {
          file,
          kind,
          durationMs,
          ...(kind === "voice" ? { waveform: toWaveform(r.samples) } : {}),
        };
        if (done) done(note);
        // Hit the time limit while nobody was pressing Send: hand it to whoever is listening.
        else autoStopped.current(note);
      };
      recorder.start(250);
      setState({ phase: "recording", kind, startedAt, stream });
      return null;
    },
    [cleanup],
  );

  return {
    state,
    elapsed,
    level,
    start,
    stop: () => finish(false),
    cancel: () => void finish(true),
  };
}
