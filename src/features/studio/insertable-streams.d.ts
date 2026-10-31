// Chrome's "breakout box" (MediaStreamTrack Insertable Streams), not yet in TypeScript's DOM lib.
declare class MediaStreamTrackProcessor<T extends VideoFrame = VideoFrame> {
  constructor(init: { track: MediaStreamTrack; maxBufferSize?: number });
  readonly readable: ReadableStream<T>;
}

declare class MediaStreamTrackGenerator<T extends VideoFrame = VideoFrame> extends MediaStreamTrack {
  constructor(init: { kind: "video" | "audio" });
  readonly writable: WritableStream<T>;
}
