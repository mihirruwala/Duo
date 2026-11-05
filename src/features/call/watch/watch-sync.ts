/**
 * Keeps two YouTube players in step. Each person plays the video locally (full quality, no DRM
 * black screen, no film audio pushed through the call); only small "play/pause at t" messages
 * cross the wire.
 *
 * Rules:
 *  - Whoever acts (play, pause, seek, open) becomes the *driver*. Only the driver sends
 *    heartbeats, so two players never tug each other back and forth.
 *  - A follower corrects itself when it drifts more than DRIFT_S from the driver.
 *  - Changes we apply because of a remote message are not echoed back (a short quiet window).
 */

/** The subset of the YouTube IFrame player we use (also implemented by the unit-test fake). */
export type SyncPlayer = {
  getCurrentTime(): number;
  getPlayerState(): number;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
};

export const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

export type PlaybackState = { at: number; playing: boolean; hb?: boolean };

const DRIFT_S = 1.0;
const PAUSED_DRIFT_S = 0.4;
/** Rough one-way delay of a data message; a playing follower aims slightly ahead. */
const LATENCY_S = 0.15;
const QUIET_MS = 1200;
const HEARTBEAT_MS = 4000;
/** A jump bigger than this between ticks (beyond normal playback) is a seek. */
const SEEK_JUMP_S = 2;

export class WatchSync {
  private quietUntil = 0;
  private driver: boolean;
  private lastHeartbeat = 0;
  private lastTick: { at: number; time: number; playing: boolean } | null = null;
  /** True while the browser refuses to start playback without a click (autoplay policy). */
  needsGesture = false;
  private wantPlaying = false;
  private gestureCheck: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly player: SyncPlayer,
    private readonly send: (s: PlaybackState) => void,
    opts: { driver: boolean; now?: () => number; onNeedsGesture?: (needs: boolean) => void },
  ) {
    this.driver = opts.driver;
    this.now = opts.now ?? (() => performance.now());
    this.onNeedsGesture = opts.onNeedsGesture ?? (() => undefined);
  }
  private readonly now: () => number;
  private readonly onNeedsGesture: (needs: boolean) => void;

  get isDriver() {
    return this.driver;
  }

  /** Current local playback, for replying to a late joiner. */
  snapshot(): PlaybackState {
    const s = this.player.getPlayerState();
    return {
      at: this.player.getCurrentTime(),
      playing: s === YT_STATE.PLAYING || (s === YT_STATE.BUFFERING && this.wantPlaying),
    };
  }

  /** A message from the other person. */
  applyRemote(state: PlaybackState) {
    if (!state.hb) this.driver = false;
    else if (this.driver) return; // two drivers would fight; the latest actor wins on their next action
    const current = this.player.getCurrentTime();
    const target = state.playing ? state.at + LATENCY_S : state.at;
    const drift = Math.abs(current - target);
    const localState = this.player.getPlayerState();
    const localPlaying = localState === YT_STATE.PLAYING || localState === YT_STATE.BUFFERING;

    this.quietUntil = this.now() + QUIET_MS;
    if (drift > (state.playing ? DRIFT_S : PAUSED_DRIFT_S)) this.player.seekTo(target, true);
    if (state.playing && !localPlaying) this.player.playVideo();
    if (!state.playing && localPlaying) this.player.pauseVideo();
    this.wantPlaying = state.playing;
    this.lastTick = { at: this.now(), time: target, playing: state.playing };
    if (state.playing) this.checkGesture();
    else this.setNeedsGesture(false);
  }

  /** The YouTube player's onStateChange. */
  onLocalState(ytState: number) {
    if (ytState === YT_STATE.PLAYING) this.setNeedsGesture(false);
    if (ytState === YT_STATE.PLAYING || ytState === YT_STATE.PAUSED || ytState === YT_STATE.ENDED) {
      const playing = ytState === YT_STATE.PLAYING;
      // Right after applying a remote change, the player reports it back: that echo is ignored.
      // Anything *different* (the person pausing straight after a remote play) is a real action.
      if (this.now() < this.quietUntil && playing === this.wantPlaying) return;
      // Pausing because the video ended isn't a decision; don't steal the driver role for it.
      if (ytState === YT_STATE.ENDED && !this.wantPlaying) return;
      this.wantPlaying = playing;
      this.act({ at: this.player.getCurrentTime(), playing });
    }
  }

  /** Call about once a second: heartbeats (driver) and seek detection while paused. */
  tick() {
    const now = this.now();
    const time = this.player.getCurrentTime();
    const s = this.player.getPlayerState();
    const playing = s === YT_STATE.PLAYING;
    const prev = this.lastTick;
    this.lastTick = { at: now, time, playing };
    if (now < this.quietUntil || !prev) return;

    // A seek that didn't produce a state change (scrubbing while paused, or a jump while playing).
    // Falling behind the clock is buffering, not a seek: only a jump ahead or backwards counts.
    const expected = prev.time + (prev.playing ? (now - prev.at) / 1000 : 0);
    const jumped = time > expected + SEEK_JUMP_S || time < prev.time - SEEK_JUMP_S;
    if (jumped && s !== YT_STATE.BUFFERING) {
      this.act({ at: time, playing });
      return;
    }
    if (this.driver && playing && now - this.lastHeartbeat >= HEARTBEAT_MS) {
      this.lastHeartbeat = now;
      this.send({ at: time, playing: true, hb: true });
    }
  }

  /** The user (not a remote message) did something. */
  private act(state: PlaybackState) {
    this.driver = true;
    this.lastHeartbeat = this.now();
    this.send(state);
  }

  private checkGesture() {
    if (this.gestureCheck) clearTimeout(this.gestureCheck);
    this.gestureCheck = setTimeout(() => {
      const s = this.player.getPlayerState();
      this.setNeedsGesture(this.wantPlaying && s !== YT_STATE.PLAYING && s !== YT_STATE.BUFFERING);
    }, 2500);
  }

  private setNeedsGesture(needs: boolean) {
    if (needs === this.needsGesture) return;
    this.needsGesture = needs;
    this.onNeedsGesture(needs);
  }

  /** "Tap to play" after the browser blocked autoplay. Runs inside the click handler. */
  resumeFromGesture() {
    this.quietUntil = this.now() + QUIET_MS;
    this.player.playVideo();
  }

  dispose() {
    if (this.gestureCheck) clearTimeout(this.gestureCheck);
  }
}
