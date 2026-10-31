"use client";

/* eslint-disable @next/next/no-img-element -- local static thumbnails */
import { useEffect, useRef, useState } from "react";
import type { LocalVideoTrack } from "livekit-client";
import { Ban, ImagePlus, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { BACKGROUNDS, DEFAULT_STUDIO, EFFECTS, FACE_FILTERS, type FaceFilterId, type StudioConfig } from "@/shared/studio";
import type { StudioStats } from "../studio-processor";
import {
  getCustomBackground,
  setCustomBackground,
  setStudioConfig,
  studioSupported,
  useCustomBackgroundRevision,
  useStudioConfig,
} from "../studio-store";

type Tab = "animals" | "funny" | "cartoon" | "backgrounds" | "effects";
const TABS: { id: Tab; label: string }[] = [
  { id: "animals", label: "Animals" },
  { id: "funny", label: "Funny" },
  { id: "cartoon", label: "Cartoon" },
  { id: "backgrounds", label: "Backgrounds" },
  { id: "effects", label: "Live effects" },
];

const FACE_EMOJI: Record<FaceFilterId, string> = {
  dog: "🐶",
  cat: "🐱",
  sunglasses: "🕶️",
  "big-glasses": "👀",
  crown: "👑",
  hearts: "💕",
  confetti: "🎉",
};
const EFFECT_SWATCH: Record<string, string> = {
  bw: "linear-gradient(135deg,#eee,#333)",
  vintage: "linear-gradient(135deg,#e9c99a,#7a5230)",
  vhs: "repeating-linear-gradient(0deg,#3b2a6b 0 3px,#6b3b8b 3px 6px)",
  retro: "linear-gradient(135deg,#7fe0c0,#2f5d50)",
  pixelate: "conic-gradient(#ff8a6e 0 25%,#a593ff 0 50%,#7fe0c0 0 75%,#ffd36b 0)",
  night: "radial-gradient(circle,#4cff6a,#0b3a12)",
  invert: "linear-gradient(135deg,#1aa3c8,#ff9ec7)",
};

export function StudioPanel({
  open,
  onOpenChange,
  track,
  stats,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The (processed) local camera, for the live preview. */
  track: LocalVideoTrack | null | undefined;
  stats: StudioStats | null;
}) {
  const config = useStudioConfig();
  const [tab, setTab] = useState<Tab>("funny");
  const [lastFace, setLastFace] = useState<FaceFilterId>("sunglasses");
  const fileRef = useRef<HTMLInputElement>(null);
  const supported = studioSupported();
  const set = (patch: Partial<StudioConfig>) => setStudioConfig({ ...config, ...patch });
  const faceOn = config.face !== "none";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="z-[66] flex max-h-[92dvh] flex-col gap-4 overflow-hidden rounded-[1.75rem] sm:max-w-2xl"
        data-testid="studio-panel"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Sparkles className="size-6 text-mint" /> DUO Studio
          </DialogTitle>
          <DialogDescription>
            Your person sees exactly this, live. Effects run on your device; nothing is uploaded.
          </DialogDescription>
        </DialogHeader>

        {!supported ? (
          <p className="rounded-2xl border border-sun/30 bg-sun/10 p-4 text-sm text-sun">
            Effects need a recent desktop Chrome or Edge (they use your GPU through insertable media streams). Your call still
            works normally.
          </p>
        ) : (
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
            <StudioPreview track={track} stats={stats} />

            <div className="grid gap-3 sm:grid-cols-3">
              <ToggleRow
                label="Background blur"
                checked={config.background.kind === "blur"}
                onChange={(on) => set({ background: on ? { kind: "blur", strength: 0.6 } : { kind: "none" } })}
              />
              <ToggleRow label="VHS" checked={config.effect === "vhs"} onChange={(on) => set({ effect: on ? "vhs" : "none" })} />
              <ToggleRow
                label="Face tracking"
                checked={faceOn}
                onChange={(on) => {
                  if (!on && faceOn) setLastFace(config.face as FaceFilterId);
                  set({ face: on ? lastFace : "none" });
                }}
              />
            </div>
            {config.background.kind === "blur" && (
              <label className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-muted-foreground">Blur strength</span>
                <Slider
                  min={20}
                  max={100}
                  step={5}
                  value={[Math.round(config.background.strength * 100)]}
                  onValueChange={([v]) => set({ background: { kind: "blur", strength: (v ?? 60) / 100 } })}
                  aria-label="Blur strength"
                />
              </label>
            )}

            <div role="tablist" aria-label="Studio categories" className="flex flex-wrap gap-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  type="button"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors",
                    tab === t.id ? "bg-ink-3 text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="tabpanel">
              {(tab === "animals" || tab === "funny" || tab === "cartoon") && (
                <>
                  <Option label="None" selected={config.face === "none"} onClick={() => set({ face: "none" })}>
                    <Ban className="size-6 text-muted-foreground" />
                  </Option>
                  {FACE_FILTERS.filter((f) => f.category === tab).map((f) => (
                    <Option key={f.id} label={f.label} selected={config.face === f.id} onClick={() => set({ face: f.id })}>
                      <span className="text-3xl">{FACE_EMOJI[f.id]}</span>
                    </Option>
                  ))}
                </>
              )}
              {tab === "backgrounds" && (
                <>
                  <Option
                    label="None"
                    selected={config.background.kind === "none"}
                    onClick={() => set({ background: { kind: "none" } })}
                  >
                    <Ban className="size-6 text-muted-foreground" />
                  </Option>
                  <Option
                    label="Blur"
                    selected={config.background.kind === "blur"}
                    onClick={() => set({ background: { kind: "blur", strength: 0.6 } })}
                  >
                    <span className="size-full rounded-lg bg-[radial-gradient(circle,#b6a9c2,#3a2f44)] blur-[2px]" />
                  </Option>
                  {BACKGROUNDS.map((b) => (
                    <Option
                      key={b.id}
                      label={b.label}
                      selected={config.background.kind === "image" && config.background.id === b.id}
                      onClick={() => set({ background: { kind: "image", id: b.id } })}
                    >
                      <img src={`/backgrounds/${b.id}.svg`} alt="" className="size-full rounded-lg object-cover" />
                    </Option>
                  ))}
                  <CustomBackgroundOption
                    selected={config.background.kind === "image" && config.background.id === "custom"}
                    onPick={() => fileRef.current?.click()}
                  />
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    data-testid="custom-background-input"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      const err = await setCustomBackground(file);
                      if (err) toast.error(err);
                    }}
                  />
                </>
              )}
              {tab === "effects" && (
                <>
                  <Option label="None" selected={config.effect === "none"} onClick={() => set({ effect: "none" })}>
                    <Ban className="size-6 text-muted-foreground" />
                  </Option>
                  {EFFECTS.map((fx) => (
                    <Option
                      key={fx.id}
                      label={fx.label}
                      selected={config.effect === fx.id}
                      onClick={() => set({ effect: fx.id })}
                    >
                      <span className="size-full rounded-lg" style={{ background: EFFECT_SWATCH[fx.id] }} />
                    </Option>
                  ))}
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setStudioConfig(DEFAULT_STUDIO)}
              className="flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-ink-3 hover:text-foreground"
            >
              <RotateCcw className="size-4" /> Turn everything off
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-ink-1/60 px-3 py-2.5 text-sm font-semibold">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

function Option({
  label,
  selected,
  onClick,
  children,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={`studio-option-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-2xl border p-2 text-xs font-semibold transition-colors",
        selected
          ? "border-coral bg-coral/10 text-foreground"
          : "border-border bg-ink-1/50 text-muted-foreground hover:bg-ink-3 hover:text-foreground",
      )}
    >
      <span className="grid aspect-video w-full place-items-center overflow-hidden rounded-lg bg-ink-2">{children}</span>
      {label}
    </button>
  );
}

function CustomBackgroundOption({ selected, onPick }: { selected: boolean; onPick: () => void }) {
  const revision = useCustomBackgroundRevision();
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    const bmp = getCustomBackground().bitmap;
    if (!bmp) return;
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 90;
    c.getContext("2d")!.drawImage(bmp, 0, 0, 160, 90);
    const url = c.toDataURL("image/jpeg", 0.7);
    const t = setTimeout(() => setThumb(url), 0);
    return () => clearTimeout(t);
  }, [revision]);
  return (
    <Option label="Your image" selected={selected} onClick={onPick}>
      {thumb ? (
        <img src={thumb} alt="" className="size-full object-cover" />
      ) : (
        <ImagePlus className="size-6 text-muted-foreground" />
      )}
    </Option>
  );
}

function StudioPreview({ track, stats }: { track: LocalVideoTrack | null | undefined; stats: StudioStats | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-ink-0">
      {track ? (
        <video
          ref={ref}
          muted
          playsInline
          autoPlay
          className="h-full w-full -scale-x-100 object-cover"
          data-testid="studio-preview"
        />
      ) : (
        <p className="grid h-full place-items-center text-sm text-muted-foreground">Turn your camera on to preview effects.</p>
      )}
      <PerfBadge stats={stats} />
    </div>
  );
}

/** Performance read-out: always in development, or with ?debug=1. */
export function PerfBadge({ stats, className }: { stats: StudioStats | null; className?: string }) {
  const [show] = useState(
    () =>
      process.env.NODE_ENV === "development" ||
      (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug")),
  );
  if (!show || !stats) return null;
  return (
    <span
      className={cn("absolute top-2 left-2 rounded-lg bg-black/70 px-2 py-1 font-mono text-[0.7rem] text-white", className)}
      data-testid="studio-perf"
      data-fps={stats.fps}
      data-ms={stats.ms}
    >
      {stats.fps} fps · {stats.ms} ms · seg {stats.segMs} ({stats.delegate.segmenter}) · face {stats.faceMs} (
      {stats.delegate.face}) · L{stats.level}
    </span>
  );
}
