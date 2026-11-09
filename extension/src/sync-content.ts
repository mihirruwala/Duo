/**
 * Sync a show: injected (only) into the tab the person picked from the popup. Finds the page's
 * main <video>, and runs the same WatchSync engine DUO uses for YouTube against it. Talks only to
 * this extension's service worker; never to the page's own scripts, except the Netflix seek helper
 * the worker installs in the page (Netflix's player crashes if its <video> is seeked directly).
 */
import { WatchSync, YT_STATE, type PlaybackState, type SyncPlayer } from "../../src/features/call/watch/watch-sync";
import { seekNeedsPlayerApi } from "../../src/shared/tab-sync";

type FromWorker =
  | { type: "content.remote"; state: PlaybackState }
  | { type: "content.snapshot" }
  | { type: "content.stop" }
  | { type: "content.ping" };

const flag = window as unknown as { __duoSync?: boolean };
if (!flag.__duoSync) {
  flag.__duoSync = true;
  start();
}

function start() {
  const viaPlayerApi = seekNeedsPlayerApi(location.hostname);
  let video: HTMLVideoElement | null = null;
  let stopped = false;
  let lastStatus = "";

  /** The biggest video on the page that has media; ads and previews are usually smaller. */
  function findVideo(): HTMLVideoElement | null {
    let best: HTMLVideoElement | null = null;
    let bestArea = -1;
    for (const v of Array.from(document.querySelectorAll("video"))) {
      if (!(v.currentSrc || v.srcObject) || !Number.isFinite(v.duration) || v.duration <= 0) continue;
      const r = v.getBoundingClientRect();
      const area = Math.max(1, r.width * r.height);
      if (area > bestArea) {
        best = v;
        bestArea = area;
      }
    }
    return best;
  }

  const player: SyncPlayer = {
    getCurrentTime: () => video?.currentTime ?? 0,
    getPlayerState: () => {
      if (!video) return YT_STATE.UNSTARTED;
      if (video.ended) return YT_STATE.ENDED;
      if (video.paused) return YT_STATE.PAUSED;
      return video.readyState < 3 || video.seeking ? YT_STATE.BUFFERING : YT_STATE.PLAYING;
    },
    playVideo: () => void video?.play().catch(() => undefined),
    pauseVideo: () => video?.pause(),
    seekTo: (s) => {
      if (!video) return;
      if (viaPlayerApi) window.postMessage({ __duo: "seek", ms: Math.round(s * 1000) }, location.origin);
      else video.currentTime = s;
    },
  };

  const send = (msg: object) => chrome.runtime.sendMessage(msg).catch(() => undefined);
  const sync = new WatchSync(player, (state) => void send({ type: "content.local", state }), {
    driver: false,
    onNeedsGesture: () => reportStatus(),
  });

  function reportStatus() {
    const status = { type: "content.status", video: !!video, needsGesture: sync.needsGesture };
    const key = JSON.stringify(status);
    if (key === lastStatus) return;
    lastStatus = key;
    void send(status);
  }

  const onPlay = () => sync.onLocalState(YT_STATE.PLAYING);
  const onPause = () => {
    if (video && !video.ended) sync.onLocalState(YT_STATE.PAUSED);
  };
  const onEnded = () => sync.onLocalState(YT_STATE.ENDED);

  function attach(v: HTMLVideoElement | null) {
    if (v === video) return;
    if (video) {
      video.removeEventListener("playing", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
    }
    video = v;
    if (video) {
      video.addEventListener("playing", onPlay);
      video.addEventListener("pause", onPause);
      video.addEventListener("ended", onEnded);
    }
    reportStatus();
  }

  // The player can swap its <video> (next episode, ads), so keep looking. The title follows the episode.
  let title = document.title;
  const tick = setInterval(() => {
    if (stopped) return;
    if (document.title !== title) {
      title = document.title;
      void send({ type: "content.title", title });
    }
    if (!video || !video.isConnected || !(video.currentSrc || video.srcObject)) attach(findVideo());
    if (video) sync.tick();
  }, 1000);
  attach(findVideo());

  function stop() {
    stopped = true;
    clearInterval(tick);
    attach(null);
    sync.dispose();
    flag.__duoSync = false;
    chrome.runtime.onMessage.removeListener(onMessage);
  }

  function onMessage(msg: FromWorker, sender: chrome.runtime.MessageSender, reply: (r: unknown) => void) {
    if (sender.id !== chrome.runtime.id || stopped) return;
    switch (msg.type) {
      case "content.remote":
        if (!video) attach(findVideo());
        if (video) sync.applyRemote(msg.state);
        return;
      case "content.snapshot":
        if (!video) attach(findVideo());
        reply(video ? sync.snapshot() : null);
        return;
      case "content.ping":
        reply({ alive: true });
        return;
      case "content.stop":
        stop();
        return;
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);
}
