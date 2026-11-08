"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import {
  RoomEvent,
  Track,
  VideoPreset,
  VideoPresets,
  VideoQuality,
  type LocalParticipant,
  type RemoteParticipant,
  type Room,
  type TrackPublishOptions,
  type VideoCaptureOptions,
} from "livekit-client";
import { encodeFun, FUN_TOPIC, parseFun, type CallMode } from "@/shared/fun";
import { keepScreenAwake } from "./wake-lock";

/**
 * Hang-out mode: an open line you leave on for hours.
 *  - your camera is captured and sent at 360p / 20 fps (one 180p simulcast layer below it)
 *  - their camera is received at no more than the medium layer
 *  - Studio effects are paused (the caller passes `paused` to useStudioTrack)
 *  - the screen is kept awake, so a phone doesn't lock and drop the call
 * Sleep goes further: your camera goes off, their video stops downloading, the screen goes black.
 * Audio keeps flowing both ways the whole time.
 *
 * Each person picks their own mode; the other side is told over a data message so DUO can show
 * "Hana is asleep". It survives a rejoin (kept in sessionStorage per room).
 */

const LIGHT_HEIGHT = 360;
export const HANGOUT_CAPTURE: VideoCaptureOptions = { resolution: { width: 640, height: LIGHT_HEIGHT, frameRate: 20 } };
export const HANGOUT_PUBLISH: TrackPublishOptions = {
  videoEncoding: new VideoPreset(640, LIGHT_HEIGHT, 350_000, 20).encoding,
  videoSimulcastLayers: [VideoPresets.h180],
};

type Saved = { mode: CallMode; camBeforeSleep: boolean };
const storageKey = (roomName: string) => `duo.hangout.${roomName}`;

function load(roomName: string): Saved {
  try {
    const raw = JSON.parse(sessionStorage.getItem(storageKey(roomName)) ?? "null") as Partial<Saved> | null;
    if (raw && (raw.mode === "hangout" || raw.mode === "sleep")) return { mode: raw.mode, camBeforeSleep: !!raw.camBeforeSleep };
  } catch {
    // Storage blocked: start normal.
  }
  return { mode: "normal", camBeforeSleep: false };
}

function save(roomName: string, s: Saved) {
  try {
    if (s.mode === "normal") sessionStorage.removeItem(storageKey(roomName));
    else sessionStorage.setItem(storageKey(roomName), JSON.stringify(s));
  } catch {
    // Not persisted; fine for this page.
  }
}

/** Was this camera captured with the light settings? */
function isLight(lp: LocalParticipant) {
  const h = lp.getTrackPublication(Track.Source.Camera)?.track?.constraints.height;
  return typeof h === "number" ? h <= LIGHT_HEIGHT : false;
}

/** Capture/publish options for turning the camera on in the current mode. */
export function cameraOptionsFor(mode: CallMode): [VideoCaptureOptions | undefined, TrackPublishOptions | undefined] {
  return mode === "normal" ? [undefined, undefined] : [HANGOUT_CAPTURE, HANGOUT_PUBLISH];
}

/**
 * Publish options only apply when a track is first published, so switching modes swaps the
 * camera track for a new one (a brief blink). A camera that's off is just unpublished: the next
 * "camera on" publishes fresh with the right options.
 */
async function republishCamera(room: Room, mode: CallMode) {
  const lp = room.localParticipant;
  const pub = lp.getTrackPublication(Track.Source.Camera);
  if (!pub?.track) return;
  const wasOn = !pub.isMuted;
  const deviceId = room.getActiveDevice("videoinput");
  await lp.unpublishTrack(pub.track, true);
  if (!wasOn) return;
  const [capture, publish] = cameraOptionsFor(mode);
  await lp.setCameraEnabled(true, { ...capture, ...(deviceId && deviceId !== "default" ? { deviceId } : {}) }, publish);
}

export function useHangout() {
  const room = useRoomContext();
  const { cameraTrack, isCameraEnabled } = useLocalParticipant();
  const [saved, setSaved] = useState<Saved>(() => load(room.name));
  const [partnerMode, setPartnerMode] = useState<CallMode>("normal");
  const mode = saved.mode;
  const busy = useRef<Promise<unknown>>(Promise.resolve());

  const update = useCallback(
    (next: Saved) => {
      save(room.name, next);
      setSaved(next);
    },
    [room],
  );

  // Tell the other person, now and whenever they (re)join.
  const announce = useEffectEvent(() => {
    void room.localParticipant
      .publishData(encodeFun({ v: 1, t: "mode", mode }), { reliable: true, topic: FUN_TOPIC })
      .catch(() => undefined);
  });
  const announced = useRef<CallMode>("normal");
  useEffect(() => {
    // Don't announce "normal" on first mount: that's what they assume anyway.
    if (mode === announced.current) return;
    announced.current = mode;
    announce();
  }, [mode]);
  useEffect(() => {
    const onJoined = () => {
      if (announced.current !== "normal") announce();
    };
    const onLeft = () => setPartnerMode("normal");
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic !== FUN_TOPIC || !participant) return;
      const m = parseFun(payload);
      if (m?.t === "mode") setPartnerMode(m.mode);
    };
    room.on(RoomEvent.ParticipantConnected, onJoined);
    room.on(RoomEvent.ParticipantDisconnected, onLeft);
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoined);
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  // Our camera: light while hanging out, normal otherwise. Re-checked whenever the track changes.
  const lightWanted = mode !== "normal";
  useEffect(() => {
    if (!cameraTrack?.track) return;
    if (isLight(room.localParticipant) === lightWanted) return;
    busy.current = busy.current.then(() => republishCamera(room, lightWanted ? "hangout" : "normal")).catch(() => undefined);
  }, [room, cameraTrack, lightWanted]);

  // Sleep: camera off while asleep, back on when waking if it was on before.
  const sleeping = mode === "sleep";
  const camOnRef = useRef(isCameraEnabled);
  useEffect(() => {
    camOnRef.current = isCameraEnabled;
  }, [isCameraEnabled]);
  useEffect(() => {
    if (sleeping && isCameraEnabled) {
      busy.current = busy.current.then(() => room.localParticipant.setCameraEnabled(false)).catch(() => undefined);
    }
  }, [room, sleeping, isCameraEnabled]);

  // Their video: capped while hanging out, not downloaded at all while asleep. Only touch
  // "enabled" after a sleep: setting it at all overrides adaptive stream's own on/off.
  const slept = useRef(false);
  useEffect(() => {
    if (sleeping) slept.current = true;
    const apply = () => {
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.videoTrackPublications.values()) {
          if (!pub.isDesired) continue;
          if (slept.current) pub.setEnabled(!sleeping);
          if (pub.source === Track.Source.Camera) pub.setVideoQuality(lightWanted ? VideoQuality.MEDIUM : VideoQuality.HIGH);
        }
      }
    };
    apply();
    room.on(RoomEvent.TrackSubscribed, apply);
    return () => {
      room.off(RoomEvent.TrackSubscribed, apply);
    };
  }, [room, sleeping, lightWanted]);

  // Keep the screen on while the line is open.
  useEffect(() => (lightWanted ? keepScreenAwake() : undefined), [lightWanted]);

  const setMode = useCallback(
    (next: CallMode) => {
      if (next === mode) return;
      if (next === "sleep") return update({ mode: "sleep", camBeforeSleep: camOnRef.current });
      if (mode === "sleep" && saved.camBeforeSleep) {
        const [capture, publish] = cameraOptionsFor(next);
        busy.current = busy.current
          .then(() => room.localParticipant.setCameraEnabled(true, capture, publish))
          .catch(() => undefined);
      }
      update({ mode: next, camBeforeSleep: false });
    },
    [mode, saved.camBeforeSleep, room, update],
  );

  return { mode, partnerMode, setMode };
}
