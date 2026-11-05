"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Clapperboard, Headphones, Loader2, Maximize2, Play, Replace, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FullscreenButton, FullscreenPartner, useFullscreen } from "../components/fullscreen";
import type { WatchTogether } from "./use-watch-together";
import { describeYouTubeError, loadYouTube, type YTPlayer } from "./youtube-api";

const TIP_KEY = "duo.watchTip.v1";

/**
 * The shared YouTube player. Each person streams the video themselves; the sync hook keeps
 * play/pause/position in step. The player frame is created imperatively inside a div React never
 * touches, and this component keeps its place in the tree when the layout changes, so pinning a
 * person (which turns this into a small tile) doesn't reload the video.
 */
export function WatchStage({
  watch,
  compact,
  style,
  onActivate,
  onChangeVideo,
}: {
  watch: WatchTogether;
  compact: boolean;
  style?: React.CSSProperties;
  onActivate: (e: React.MouseEvent) => void;
  onChangeVideo: () => void;
}) {
  const session = watch.session;
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | { error: string }>("loading");
  const [title, setTitle] = useState<string | null>(null);
  /** YouTube's own player state (-1 unstarted, 1 playing, 2 paused, 3 buffering…). Ads show as -1/3. */
  const [playerState, setPlayerState] = useState<number | null>(null);
  const [showTip, setShowTip] = useState(false);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const fullscreen = useFullscreen(stageEl);

  useEffect(() => {
    try {
      if (!localStorage.getItem(TIP_KEY)) {
        const t = setTimeout(() => setShowTip(true), 0);
        return () => clearTimeout(t);
      }
    } catch {
      // No storage: skip the tip.
    }
  }, []);

  const onReady = useEffectEvent((player: YTPlayer) => {
    if (!session) return;
    setStatus("ready");
    const sync = watch.attach(session.id, player);
    if (!sync) return;
    if (session.mine) {
      if (session.initial.at > 0) player.seekTo(session.initial.at, true);
      player.playVideo();
    } else {
      sync.applyRemote(session.initial);
    }
  });
  const onState = useEffectEvent((state: number, player: YTPlayer) => {
    const t = player.getVideoData().title;
    if (t) setTitle(t);
    setPlayerState(state);
    if (session) watch.onPlayerState(session.id, state);
  });

  const sessionId = session?.id;
  const videoId = session?.videoId;
  useEffect(() => {
    if (!sessionId || !videoId || !hostRef.current) return;
    let player: YTPlayer | null = null;
    let disposed = false;
    const mount = document.createElement("div");
    mount.className = "h-full w-full";
    hostRef.current.replaceChildren(mount);
    loadYouTube()
      .then((YT) => {
        if (disposed) return;
        player = new YT.Player(mount, {
          host: "https://www.youtube-nocookie.com",
          videoId,
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
          events: {
            onReady: (e) => onReady(e.target),
            onStateChange: (e) => onState(e.data, e.target),
            onError: (e) => setStatus({ error: describeYouTubeError(e.data) }),
          },
        });
        player.getIframe().setAttribute("title", "Watch Together video");
        player.getIframe().setAttribute("data-testid", "watch-iframe");
      })
      .catch((err: Error) => !disposed && setStatus({ error: err.message }));
    return () => {
      disposed = true;
      watch.attach(sessionId, null);
      try {
        player?.destroy();
      } catch {
        // Player already gone.
      }
    };
    // `watch.attach` is stable; the player is rebuilt only for a new session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, videoId]);

  if (!session) return null;

  function dismissTip() {
    setShowTip(false);
    try {
      localStorage.setItem(TIP_KEY, "1");
    } catch {
      // Not remembered.
    }
  }

  return (
    <div
      ref={setStageEl}
      style={style}
      data-testid="watch-stage"
      data-slot={compact ? "thumb" : "main"}
      data-video-id={session.videoId}
      data-status={typeof status === "string" ? status : "error"}
      data-player-state={playerState ?? undefined}
      className={cn(
        "relative flex min-h-0 flex-col overflow-hidden bg-ink-0 ring-1 ring-white/8",
        compact ? "aspect-video w-full rounded-2xl" : "h-full rounded-[1.75rem]",
      )}
    >
      {!compact && (
        <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2 sm:px-4">
          <Clapperboard className="size-4 shrink-0 text-coral" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold" data-testid="watch-title">
              {title ?? "Watching together"}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              Watching together · started by {session.startedBy === "You" ? "you" : session.startedBy}
            </span>
          </span>
          <Button size="sm" variant="ghost" onClick={onChangeVideo} aria-label="Change video">
            <Replace /> <span className="max-sm:hidden">Change</span>
          </Button>
          <FullscreenButton active={fullscreen.active} onToggle={fullscreen.toggle} />
          <Button size="sm" variant="danger" onClick={watch.close} data-testid="watch-end">
            <X /> End
          </Button>
        </div>
      )}

      {showTip && !compact && status === "ready" && (
        <div className="flex items-center gap-2 border-b border-white/8 bg-ink-1 px-3 py-1.5 text-xs sm:px-4" role="note">
          <Headphones className="size-3.5 shrink-0 text-coral" aria-hidden />
          <span className="flex-1">Headphones work best: otherwise your mic picks up the video and they hear it twice.</span>
          <button
            type="button"
            onClick={dismissTip}
            aria-label="Dismiss tip"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1 bg-black">
        <div ref={hostRef} className="absolute inset-0" />
        {status === "loading" && (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground" role="status">
            <Loader2 className="size-6 animate-spin" aria-label="Loading video" />
          </div>
        )}
        {typeof status === "object" && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center" role="alert">
            <div className="flex max-w-sm flex-col items-center gap-3">
              <p className="font-semibold">{status.error}</p>
              {!compact && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={onChangeVideo}>
                    Pick another video
                  </Button>
                  <Button size="sm" variant="outline" onClick={watch.close}>
                    End
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
        {watch.needsGesture && !compact && (
          <button
            type="button"
            onClick={watch.resume}
            className="absolute inset-0 z-10 grid place-items-center bg-black/60 text-white"
            data-testid="watch-resume"
          >
            <span className="flex items-center gap-2 rounded-full bg-coral px-5 py-3 font-bold text-ink-0">
              <Play className="size-5" /> Join playback
            </span>
          </button>
        )}
      </div>

      {fullscreen.active && <FullscreenPartner />}

      {compact && (
        <button
          type="button"
          onClick={onActivate}
          aria-label="Make the video big"
          data-testid="watch-activate"
          className="absolute inset-0 z-20 flex items-end justify-start bg-gradient-to-t from-black/60 to-transparent p-2"
        >
          <span className="flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur">
            <Clapperboard className="size-3" aria-hidden /> Watching
            <Maximize2 className="size-3" aria-hidden />
          </span>
        </button>
      )}
    </div>
  );
}
