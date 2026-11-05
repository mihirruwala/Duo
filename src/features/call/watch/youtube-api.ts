"use client";

import type { SyncPlayer } from "./watch-sync";

/** Minimal typings for the YouTube IFrame Player API (https://developers.google.com/youtube/iframe_api_reference). */
export type YTPlayer = SyncPlayer & {
  destroy(): void;
  loadVideoById(opts: { videoId: string; startSeconds?: number }): void;
  cueVideoById(opts: { videoId: string; startSeconds?: number }): void;
  getVideoData(): { title?: string; video_id?: string };
  getIframe(): HTMLIFrameElement;
};

type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      host?: string;
      videoId?: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number; target: YTPlayer }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loading: Promise<YTNamespace> | null = null;

/**
 * Loads YouTube's player API once. The CSP allows it through 'strict-dynamic' (a script added by
 * our own nonce'd code); the player itself runs in a youtube-nocookie.com frame.
 */
export function loadYouTube(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  loading ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => fail(new Error("YouTube didn't load.")), 20_000);
    function fail(err: Error) {
      clearTimeout(timer);
      loading = null;
      reject(err);
    }
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      clearTimeout(timer);
      if (window.YT?.Player) resolve(window.YT);
      else fail(new Error("YouTube didn't load."));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => fail(new Error("YouTube couldn't be reached."));
    document.head.appendChild(script);
  });
  return loading;
}

/** Human message for the player's onError codes. */
export function describeYouTubeError(code: number): string {
  switch (code) {
    case 2:
      return "That link doesn't point to a valid video.";
    case 5:
      return "This video can't play in the browser.";
    case 100:
      return "That video was removed or is private.";
    case 101:
    case 150:
    case 153:
      return "The owner doesn't allow this video to be played outside YouTube.";
    default:
      return "The video couldn't be played.";
  }
}
