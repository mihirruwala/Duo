"use client";

import { useState } from "react";
import { ChevronRight, Loader2, Mic, MicOff, SwitchCamera, Sparkles, Video, VideoOff, Volume2 } from "lucide-react";
import { ComingSoon } from "@/components/duo/coming-soon";
import { DuoAvatar } from "@/components/duo/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/shared/features";
import type { DevicePrefs } from "../device-prefs";
import { PresenceBanner } from "@/features/presence/components/presence-banner";
import { StudioPanel } from "@/features/studio/components/studio-panel";
import type { PartnerPresence } from "@/shared/presence";
import { useStudioTrack } from "@/features/studio/use-studio-track";
import { studioSummary } from "@/features/studio/summary";
import { usePreviewMedia } from "../use-preview-media";
import { DeviceSelect } from "./device-select";
import { LocalVideo } from "./local-video";
import { MicLevelMeter } from "./mic-level-meter";

type Props = {
  roomName: string;
  myName: string;
  myHue: number;
  partnerName: string | null;
  joining: boolean;
  joinError: string | null;
  onJoin: (prefs: DevicePrefs) => void;
  aside?: React.ReactNode;
  /** Live "where is my person" (absent when chat/presence isn't available). */
  presence?: PartnerPresence;
  onKnock?: () => boolean;
  /** "sheet": the phone call sheet (portrait preview, no device lists, Join pinned to the bottom). */
  variant?: "page" | "sheet";
};

export function PreCallStudio({
  roomName,
  myName,
  myHue,
  partnerName,
  joining,
  joinError,
  onJoin,
  aside,
  presence,
  onKnock,
  variant = "page",
}: Props) {
  const media = usePreviewMedia();
  const { prefs, video, audio, devices } = media;
  const studio = useStudioTrack(video);
  const [studioOpen, setStudioOpen] = useState(false);
  const [testing, setTesting] = useState(false);

  async function playTestSound() {
    setTesting(true);
    try {
      await playChime(prefs.speakerId);
    } finally {
      setTesting(false);
    }
  }

  // Phones: switch between the front and back camera instead of picking from a list.
  const canFlip = devices.cameras.length > 1 && prefs.cameraOn && !!video;
  function flipCamera() {
    const list = devices.cameras;
    const i = list.findIndex((d) => d.deviceId === prefs.cameraId);
    const next = list[(i + 1) % list.length];
    if (next) void media.selectCamera(next.deviceId);
  }

  if (variant === "sheet") {
    return (
      <div className="flex min-h-full flex-col gap-3 px-4">
        {partnerName && presence && onKnock && (
          <PresenceBanner
            partnerName={partnerName}
            presence={presence}
            onJoin={() => onJoin(prefs)}
            onKnock={onKnock}
            joining={joining}
          />
        )}
        <div className="relative mx-auto aspect-[3/4] max-h-[58dvh] w-full overflow-hidden rounded-[1.75rem] bg-ink-0 ring-1 ring-white/8">
          {video ? (
            <LocalVideo track={video} />
          ) : (
            <div className="grid h-full place-items-center">
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                <DuoAvatar name={myName} hue={myHue} size="xl" />
                <p className="text-sm text-muted-foreground">
                  {media.starting ? "Starting camera…" : (media.videoError ?? "Camera is off")}
                </p>
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-4 bg-gradient-to-t from-black/60 to-transparent p-4">
            <ToggleButton
              on={prefs.micOn && !!audio}
              onLabel="Turn off microphone"
              offLabel="Turn on microphone"
              OnIcon={Mic}
              OffIcon={MicOff}
              onClick={() => void media.setMicOn(!prefs.micOn)}
            />
            <ToggleButton
              on={prefs.cameraOn && !!video}
              onLabel="Turn off camera"
              offLabel="Turn on camera"
              OnIcon={Video}
              OffIcon={VideoOff}
              onClick={() => void media.setCameraOn(!prefs.cameraOn)}
            />
            {canFlip && (
              <button
                type="button"
                onClick={flipCamera}
                aria-label="Switch camera"
                className="grid size-12 place-items-center rounded-full bg-white/15 text-white backdrop-blur active:scale-95"
              >
                <SwitchCamera className="size-5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl bg-ink-2 px-4 py-3">
          <Mic className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <MicLevelMeter track={audio?.mediaStreamTrack} />
          <span className="truncate text-sm text-muted-foreground">
            {media.audioError ?? (audio ? "Mic is working" : "Microphone is off")}
          </span>
        </div>

        {FEATURES.studio && (
          <button
            type="button"
            onClick={() => setStudioOpen(true)}
            data-testid="open-studio"
            className="flex items-center gap-3 rounded-2xl bg-ink-2 px-4 py-3 text-left active:bg-ink-3"
          >
            <Sparkles className="size-4 text-mint" aria-hidden />
            <span className="flex-1 text-[15px] font-semibold">Filters & backgrounds</span>
            <span className="text-sm text-muted-foreground">{studioSummary(studio.config)}</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </button>
        )}

        {joinError && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {joinError}
          </p>
        )}

        <div className="sticky bottom-0 mt-auto bg-ink-1 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            size="lg"
            variant="brand"
            className="h-14 w-full rounded-2xl text-[17px]"
            onClick={() => onJoin(prefs)}
            disabled={joining || media.starting}
          >
            {joining && <Loader2 className="animate-spin" />} Join call
          </Button>
        </div>
        <StudioPanel open={studioOpen} onOpenChange={setStudioOpen} track={video} stats={studio.stats} />
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 pt-2 pb-12 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
      <section aria-label="Camera preview" className="flex flex-col gap-4">
        {partnerName && presence && onKnock && (
          <PresenceBanner
            partnerName={partnerName}
            presence={presence}
            onJoin={() => onJoin(prefs)}
            onKnock={onKnock}
            joining={joining}
          />
        )}
        <div className="relative aspect-video overflow-hidden rounded-[2rem] bg-ink-0 ring-1 ring-white/8 shadow-[var(--duo-shadow-lg)]">
          {video ? (
            <LocalVideo track={video} />
          ) : (
            <div className="grid h-full place-items-center">
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                <DuoAvatar name={myName} hue={myHue} size="xl" />
                <p className="text-sm text-muted-foreground">
                  {media.starting ? "Starting camera…" : (media.videoError ?? "Camera is off")}
                </p>
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-black/60 to-transparent p-4">
            <span className="rounded-full bg-black/40 px-3 py-1 text-sm font-semibold backdrop-blur">{myName}</span>
            <div className="flex gap-2">
              <ToggleButton
                on={prefs.micOn && !!audio}
                onLabel="Turn off microphone"
                offLabel="Turn on microphone"
                OnIcon={Mic}
                OffIcon={MicOff}
                onClick={() => void media.setMicOn(!prefs.micOn)}
              />
              <ToggleButton
                on={prefs.cameraOn && !!video}
                onLabel="Turn off camera"
                offLabel="Turn on camera"
                OnIcon={Video}
                OffIcon={VideoOff}
                onClick={() => void media.setCameraOn(!prefs.cameraOn)}
              />
            </div>
          </div>
        </div>

        <div className="surface flex flex-wrap items-center gap-4 rounded-2xl px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Mic className="size-4 text-muted-foreground" aria-hidden /> Mic check
          </span>
          <MicLevelMeter track={audio?.mediaStreamTrack} />
          <span className="text-sm text-muted-foreground">
            {media.audioError ?? (audio ? "Say something, the bars should move" : "Microphone is off")}
          </span>
        </div>
      </section>

      <section aria-label="Join" className="flex flex-col gap-5">
        <div className="surface flex flex-col gap-5 rounded-[2rem] p-6">
          <div>
            <p className="text-sm text-muted-foreground">Ready to join</p>
            <h1 className="truncate text-3xl font-extrabold" data-testid="room-name">
              {roomName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {partnerName ? `With ${partnerName}` : "Your person hasn't accepted the invite yet"}
            </p>
          </div>

          <div className="grid gap-4">
            <DeviceSelect
              id="camera-select"
              label="Camera"
              devices={devices.cameras}
              value={prefs.cameraId}
              onChange={(id) => void media.selectCamera(id)}
            />
            <DeviceSelect
              id="mic-select"
              label="Microphone"
              devices={devices.mics}
              value={prefs.micId}
              onChange={(id) => void media.selectMic(id)}
            />
            <div className="flex items-end gap-2">
              <DeviceSelect
                id="speaker-select"
                label="Speaker"
                devices={devices.speakers}
                value={prefs.speakerId}
                onChange={media.selectSpeaker}
                className="flex-1"
              />
              <Button variant="outline" size="icon" onClick={playTestSound} disabled={testing} aria-label="Play a test sound">
                {testing ? <Loader2 className="animate-spin" /> : <Volume2 />}
              </Button>
            </div>
          </div>

          {FEATURES.studio ? (
            <button
              type="button"
              onClick={() => setStudioOpen(true)}
              data-testid="open-studio"
              className="flex items-center justify-between rounded-2xl border border-border bg-ink-1/60 px-4 py-3 text-left transition-colors hover:bg-ink-3"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4 text-mint" aria-hidden /> Filters & backgrounds
              </span>
              <span className="text-xs text-muted-foreground">{studioSummary(studio.config)}</span>
            </button>
          ) : (
            <div className="flex items-center justify-between rounded-2xl border border-border bg-ink-1/60 px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4 text-mint" aria-hidden /> Filters & backgrounds
              </span>
              <ComingSoon />
            </div>
          )}

          {joinError && (
            <p
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {joinError}
            </p>
          )}

          <Button size="lg" variant="brand" onClick={() => onJoin(prefs)} disabled={joining || media.starting}>
            {joining && <Loader2 className="animate-spin" />} Join call
          </Button>
        </div>
        {aside}
      </section>
      <StudioPanel open={studioOpen} onOpenChange={setStudioOpen} track={video} stats={studio.stats} />
    </div>
  );
}

function ToggleButton({
  on,
  onLabel,
  offLabel,
  OnIcon,
  OffIcon,
  onClick,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  OnIcon: typeof Mic;
  OffIcon: typeof Mic;
  onClick: () => void;
}) {
  const Icon = on ? OnIcon : OffIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={on ? onLabel : offLabel}
      aria-pressed={on}
      className={cn(
        "grid size-11 place-items-center rounded-full backdrop-blur transition-colors max-sm:size-12",
        on ? "bg-white/15 text-white hover:bg-white/25" : "bg-danger text-ink-0 hover:brightness-110",
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

/** Short two-note chime through the chosen output device (AudioContext.setSinkId, Chrome 110+). */
async function playChime(speakerId: string | undefined) {
  const ctx = new AudioContext();
  const sinkCtx = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (speakerId && sinkCtx.setSinkId) await sinkCtx.setSinkId(speakerId).catch(() => undefined);
  const now = ctx.currentTime;
  for (const [i, freq] of [660, 880].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0, now + i * 0.18);
    gain.gain.linearRampToValueAtTime(0.25, now + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.4);
  }
  await new Promise((r) => setTimeout(r, 700));
  await ctx.close();
}
