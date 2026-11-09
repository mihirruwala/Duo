import { describe, expect, it, vi } from "vitest";
import { WatchSync, YT_STATE, type PlaybackState, type SyncPlayer } from "@/features/call/watch/watch-sync";
import { encodeWatch, findYouTube, parseWatch, parseYouTube } from "@/shared/watch";

describe("parseYouTube", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ", 0],
    ["youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s", "dQw4w9WgXcQ", 90],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ", 42],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ", 0],
    ["https://www.youtube.com/live/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ", 0],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=10", "dQw4w9WgXcQ", 10],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ", 0],
    ["  https://youtu.be/dQw4w9WgXcQ  ", "dQw4w9WgXcQ", 0],
  ])("%s", (input, id, start) => {
    expect(parseYouTube(input)).toEqual({ videoId: id, start });
  });

  it.each([
    "https://evil.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ<script>",
    "",
    "hello",
  ])("rejects %s", (input) => {
    expect(parseYouTube(input)).toBeNull();
  });

  it("finds a link inside a list item", () => {
    expect(findYouTube("Dune part two trailer https://youtu.be/Way9Dexny3w !")).toEqual({ videoId: "Way9Dexny3w", start: 0 });
    expect(findYouTube("just text")).toBeNull();
  });
});

describe("watch messages", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("round-trips valid messages", () => {
    const m = { v: 1, t: "open", id, videoId: "dQw4w9WgXcQ", at: 12.5, playing: true } as const;
    expect(parseWatch(encodeWatch(m))).toEqual(m);
  });
  it("drops junk, bad ids and oversized payloads", () => {
    const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
    expect(parseWatch(enc({ v: 1, t: "open", id, videoId: "../../x", at: 0, playing: true }))).toBeNull();
    expect(parseWatch(enc({ v: 1, t: "state", id, at: -5, playing: true }))).toBeNull();
    expect(parseWatch(enc({ v: 1, t: "nope" }))).toBeNull();
    expect(parseWatch(new TextEncoder().encode("{not json"))).toBeNull();
    expect(parseWatch(new Uint8Array(600))).toBeNull();
  });
});

/** A fake YouTube player with a controllable clock. */
function fakePlayer() {
  let clock = 0;
  let time = 0;
  let state: number = YT_STATE.PAUSED;
  const p: SyncPlayer & { advance(ms: number): void; userSeek(t: number): void } = {
    getCurrentTime: () => time,
    getPlayerState: () => state,
    playVideo: vi.fn(() => void (state = YT_STATE.PLAYING)),
    pauseVideo: vi.fn(() => void (state = YT_STATE.PAUSED)),
    seekTo: vi.fn((t: number) => void (time = t)),
    advance(ms) {
      clock += ms;
      if (state === YT_STATE.PLAYING) time += ms / 1000;
    },
    userSeek(t) {
      time = t;
    },
  };
  return { p, now: () => clock };
}

describe("WatchSync", () => {
  it("follows the other person's play/pause and corrects real drift only", () => {
    const { p, now } = fakePlayer();
    const sent: PlaybackState[] = [];
    const sync = new WatchSync(p, (s) => sent.push(s), { driver: false, now });

    sync.applyRemote({ at: 30, playing: true });
    expect(p.seekTo).toHaveBeenCalledWith(30.15, true);
    expect(p.playVideo).toHaveBeenCalled();
    // The resulting PLAYING event is ours to ignore, not an action to echo back.
    sync.onLocalState(YT_STATE.PLAYING);
    expect(sent).toHaveLength(0);

    vi.mocked(p.seekTo).mockClear();
    p.advance(4000);
    sync.applyRemote({ at: 34.5, playing: true, hb: true }); // 0.35 s apart: fine
    expect(p.seekTo).not.toHaveBeenCalled();
    sync.applyRemote({ at: 40, playing: true, hb: true }); // 5.85 s behind: catch up
    expect(p.seekTo).toHaveBeenCalledWith(40.15, true);

    sync.applyRemote({ at: 41, playing: false });
    expect(p.pauseVideo).toHaveBeenCalled();
    sync.dispose();
  });

  it("whoever acts becomes the driver and sends heartbeats; followers don't", () => {
    const { p, now } = fakePlayer();
    const sent: PlaybackState[] = [];
    const sync = new WatchSync(p, (s) => sent.push(s), { driver: false, now });
    p.advance(5000); // well past any quiet window
    p.playVideo();
    sync.onLocalState(YT_STATE.PLAYING);
    expect(sent).toEqual([{ at: 0, playing: true }]);
    expect(sync.isDriver).toBe(true);

    for (let i = 0; i < 9; i++) {
      p.advance(1000);
      sync.tick();
    }
    const beats = sent.filter((s) => s.hb);
    expect(beats.length).toBe(2);

    // The other person pauses: they drive now, so our heartbeats stop.
    sync.applyRemote({ at: 9, playing: false });
    expect(sync.isDriver).toBe(false);
    const before = sent.length;
    for (let i = 0; i < 6; i++) {
      p.advance(1000);
      sync.tick();
    }
    expect(sent.length).toBe(before);
    sync.dispose();
  });

  it("notices a seek while paused (no player event) and shares it", () => {
    const { p, now } = fakePlayer();
    const sent: PlaybackState[] = [];
    const sync = new WatchSync(p, (s) => sent.push(s), { driver: false, now });
    p.advance(3000);
    sync.tick();
    p.userSeek(120);
    p.advance(1000);
    sync.tick();
    expect(sent).toEqual([{ at: 120, playing: false }]);
    sync.dispose();
  });

  it("a seek made right after a remote pause is still shared (regression)", () => {
    const { p, now } = fakePlayer();
    const sent: PlaybackState[] = [];
    const sync = new WatchSync(p, (s) => sent.push(s), { driver: false, now });
    p.advance(1000);
    sync.tick();
    // They pause at 0:30; we skip to 5:00 half a second later, while that pause is still settling.
    sync.applyRemote({ at: 30, playing: false });
    p.advance(500);
    p.userSeek(300);
    sync.tick();
    p.advance(1000);
    sync.tick();
    expect(sent).toEqual([{ at: 300, playing: false }]);
    sync.dispose();
  });

  it("a buffering stall isn't mistaken for a seek", () => {
    const { p, now } = fakePlayer();
    const sent: PlaybackState[] = [];
    const sync = new WatchSync(p, (s) => sent.push(s), { driver: false, now });
    sync.applyRemote({ at: 10, playing: true });
    p.advance(2000);
    sync.tick();
    // The player stalls for 5 s (the clock moves, playback doesn't).
    const stalled = p.getCurrentTime();
    for (let i = 0; i < 5; i++) {
      p.advance(1000);
      p.userSeek(stalled);
      sync.tick();
    }
    expect(sent).toHaveLength(0);
    expect(sync.isDriver).toBe(false);
    sync.dispose();
  });

  it("a real pause right after a remote play is still shared", () => {
    const { p, now } = fakePlayer();
    const sent: PlaybackState[] = [];
    const sync = new WatchSync(p, (s) => sent.push(s), { driver: false, now });
    sync.applyRemote({ at: 10, playing: true });
    sync.onLocalState(YT_STATE.PLAYING); // the echo: ignored
    p.advance(300);
    p.pauseVideo();
    sync.onLocalState(YT_STATE.PAUSED); // the person: shared
    expect(sent).toEqual([{ at: expect.any(Number), playing: false }]);
    sync.dispose();
  });

  it("a heartbeat never pulls a driver back", () => {
    const { p, now } = fakePlayer();
    const sync = new WatchSync(p, () => undefined, { driver: false, now });
    p.advance(3000);
    p.playVideo();
    sync.onLocalState(YT_STATE.PLAYING);
    vi.mocked(p.seekTo).mockClear();
    sync.applyRemote({ at: 500, playing: true, hb: true });
    expect(p.seekTo).not.toHaveBeenCalled();
    sync.dispose();
  });
});
