"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, noteMetaSchema } from "@/shared/chat";
import type { AttachmentRow } from "@/shared/database";
import type { ChatMessage } from "../chat-reducer";
import { useSignedUrl } from "../signed-urls";

const SPEEDS = [1, 1.5, 2] as const;

/** Playback for a recorded note. Recorded files often don't know their own length, so the stored duration is used. */
function useNotePlayer(durationMs: number, speed = 1) {
  // The element lives in a ref (we drive it imperatively); `node` re-runs the effects when it changes.
  const elRef = useRef<HTMLMediaElement | null>(null);
  const [node, setNode] = useState<HTMLMediaElement | null>(null);
  const attach = useCallback((n: HTMLMediaElement | null) => {
    elRef.current = n;
    setNode(n);
  }, []);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onTime = () => setPosition(el.currentTime * 1000);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setPosition(0);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, [node]);
  useEffect(() => {
    if (elRef.current) elRef.current.playbackRate = speed;
  }, [node, speed]);
  const progress = durationMs > 0 ? Math.min(1, position / durationMs) : 0;
  function toggle() {
    const el = elRef.current;
    if (!el) return;
    if (el.paused) {
      // Only one note plays at a time.
      document.querySelectorAll<HTMLMediaElement>("[data-note-media]").forEach((m) => m !== el && m.pause());
      void el.play().catch(() => undefined);
    } else el.pause();
  }
  return { attach, playing, position, progress, toggle };
}

function useNoteSource(message: ChatMessage, attachment: AttachmentRow | undefined) {
  const signed = useSignedUrl(attachment?.storage_path);
  return signed ?? message.localPreview ?? null;
}

export function VoiceNote({ message, attachment }: { message: ChatMessage; attachment: AttachmentRow | undefined }) {
  const meta = noteMetaSchema.safeParse(message.meta);
  const durationMs = meta.success ? meta.data.duration_ms : 0;
  const bars = meta.success && meta.data.waveform?.length ? meta.data.waveform : Array.from({ length: 32 }, () => 40);
  const src = useNoteSource(message, attachment);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const { attach, toggle, playing, position, progress } = useNotePlayer(durationMs, speed);
  const uploading = message.status === "sending";

  return (
    <div
      className="flex w-64 max-w-full items-center gap-2.5 py-0.5"
      data-testid="voice-note"
      data-playing={playing ? "" : undefined}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={!src}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-cream text-ink-0 transition-transform active:scale-95 disabled:opacity-50"
      >
        {!src ? (
          <Loader2 className="size-4 animate-spin" />
        ) : playing ? (
          <Pause className="size-4" />
        ) : (
          <Play className="ml-0.5 size-4" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex h-8 items-center gap-[2px]" aria-hidden>
          {bars.map((b, i) => (
            <span
              key={i}
              className={cn(
                "w-[3px] shrink-0 rounded-full transition-colors",
                i / bars.length < progress ? "bg-cream" : "bg-white/30",
              )}
              style={{ height: `${Math.max(12, b)}%` }}
            />
          ))}
        </div>
        <div className="flex items-center justify-between text-[0.7rem] text-muted-foreground">
          <span className="tabular-nums" data-testid="voice-duration">
            {playing || position > 0 ? formatDuration(position) : formatDuration(durationMs)}
          </span>
          {uploading ? (
            <span>Sending… {Math.round((message.progress ?? 0) * 100)}%</span>
          ) : (
            <button
              type="button"
              onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]!)}
              aria-label={`Playback speed ${speed}×. Change`}
              className="rounded-full bg-white/10 px-1.5 font-semibold hover:bg-white/20"
            >
              {speed}×
            </button>
          )}
        </div>
      </div>
      {src && <audio ref={attach} src={src} preload="metadata" data-note-media className="hidden" />}
    </div>
  );
}

export function VideoNote({ message, attachment }: { message: ChatMessage; attachment: AttachmentRow | undefined }) {
  const meta = noteMetaSchema.safeParse(message.meta);
  const durationMs = meta.success ? meta.data.duration_ms : 0;
  const src = useNoteSource(message, attachment);
  const { attach, toggle, playing, position, progress } = useNotePlayer(durationMs);
  const uploading = message.status === "sending";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!src}
      aria-label={playing ? "Pause video message" : "Play video message"}
      data-testid="video-note"
      data-playing={playing ? "" : undefined}
      className="relative block size-52 overflow-hidden rounded-[2rem] bg-ink-1"
    >
      {src ? (
        <video
          ref={attach}
          src={`${src}#t=0.1`}
          preload="metadata"
          playsInline
          data-note-media
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="grid h-full place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </span>
      )}
      {/* Progress ring */}
      <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" aria-hidden>
        <rect
          x="1.5"
          y="1.5"
          width="97"
          height="97"
          rx="30"
          fill="none"
          stroke="var(--duo-cream)"
          strokeWidth="2.5"
          pathLength={100}
          strokeDasharray={`${progress * 100} 100`}
          opacity={progress > 0 ? 0.9 : 0}
        />
      </svg>
      {!playing && src && (
        <span className="absolute inset-0 grid place-items-center bg-black/20">
          <span className="grid size-12 place-items-center rounded-full bg-black/50 text-white backdrop-blur">
            <Play className="ml-0.5 size-5" />
          </span>
        </span>
      )}
      <span className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[0.7rem] font-semibold text-white tabular-nums">
        <Volume2 className="size-3" aria-hidden />
        {uploading
          ? `${Math.round((message.progress ?? 0) * 100)}%`
          : formatDuration(playing || position > 0 ? position : durationMs)}
      </span>
    </button>
  );
}
