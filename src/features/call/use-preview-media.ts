"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createLocalAudioTrack,
  createLocalVideoTrack,
  type LocalAudioTrack,
  type LocalVideoTrack,
  VideoPresets,
} from "livekit-client";
import { loadDevicePrefs, saveDevicePrefs, type DevicePrefs } from "./device-prefs";
import { describeMediaError } from "./media-errors";

export type DeviceLists = { cameras: MediaDeviceInfo[]; mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] };

const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/**
 * Owns the pre-call camera + mic preview. Tracks are created on mount and *always*
 * stopped on unmount (camera light goes off); the call creates its own tracks from
 * the saved device choices, so ownership is never shared.
 */
export function usePreviewMedia() {
  // Defaults on first render (matches SSR); saved choices load on mount.
  const [prefs, setPrefs] = useState<DevicePrefs>({ cameraOn: true, micOn: true });
  const [video, setVideo] = useState<LocalVideoTrack | null>(null);
  const [audio, setAudio] = useState<LocalAudioTrack | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceLists>({ cameras: [], mics: [], speakers: [] });
  const [starting, setStarting] = useState(true);

  const videoRef = useRef<LocalVideoTrack | null>(null);
  const audioRef = useRef<LocalAudioTrack | null>(null);
  const alive = useRef(true);

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    const real = (kind: MediaDeviceKind) => all.filter((d) => d.kind === kind && d.deviceId);
    if (alive.current) setDevices({ cameras: real("videoinput"), mics: real("audioinput"), speakers: real("audiooutput") });
  }, []);

  const startVideo = useCallback(async (deviceId?: string) => {
    try {
      const track = await createLocalVideoTrack({ deviceId, resolution: VideoPresets.h720.resolution });
      if (!alive.current) return track.stop();
      videoRef.current?.stop();
      videoRef.current = track;
      setVideo(track);
      setVideoError(null);
    } catch (err) {
      if (alive.current) setVideoError(describeMediaError(err, "camera"));
    }
  }, []);

  const startAudio = useCallback(async (deviceId?: string) => {
    try {
      const track = await createLocalAudioTrack({ deviceId, ...AUDIO_CONSTRAINTS });
      if (!alive.current) return track.stop();
      audioRef.current?.stop();
      audioRef.current = track;
      setAudio(track);
      setAudioError(null);
    } catch (err) {
      if (alive.current) setAudioError(describeMediaError(err, "microphone"));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const initial = loadDevicePrefs();
    void (async () => {
      await Promise.resolve();
      if (alive.current) setPrefs(initial);
      await Promise.all([
        initial.cameraOn ? startVideo(initial.cameraId) : Promise.resolve(),
        initial.micOn ? startAudio(initial.micId) : Promise.resolve(),
      ]);
      await refreshDevices();
      if (alive.current) setStarting(false);
    })();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => {
      alive.current = false;
      navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
      videoRef.current?.stop();
      audioRef.current?.stop();
      videoRef.current = null;
      audioRef.current = null;
    };
  }, [refreshDevices, startAudio, startVideo]);

  const update = useCallback((patch: Partial<DevicePrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveDevicePrefs(next);
      return next;
    });
  }, []);

  const setCameraOn = useCallback(
    async (on: boolean) => {
      update({ cameraOn: on });
      if (on) {
        await startVideo(prefs.cameraId);
        await refreshDevices();
      } else {
        videoRef.current?.stop();
        videoRef.current = null;
        setVideo(null);
      }
    },
    [prefs.cameraId, refreshDevices, startVideo, update],
  );

  const setMicOn = useCallback(
    async (on: boolean) => {
      update({ micOn: on });
      if (on) {
        await startAudio(prefs.micId);
        await refreshDevices();
      } else {
        audioRef.current?.stop();
        audioRef.current = null;
        setAudio(null);
      }
    },
    [prefs.micId, refreshDevices, startAudio, update],
  );

  const selectCamera = useCallback(
    async (id: string) => {
      update({ cameraId: id });
      if (videoRef.current) await startVideo(id);
    },
    [startVideo, update],
  );

  const selectMic = useCallback(
    async (id: string) => {
      update({ micId: id });
      if (audioRef.current) await startAudio(id);
    },
    [startAudio, update],
  );

  const selectSpeaker = useCallback((id: string) => update({ speakerId: id }), [update]);

  return {
    prefs,
    video,
    audio,
    videoError,
    audioError,
    devices,
    starting,
    setCameraOn,
    setMicOn,
    selectCamera,
    selectMic,
    selectSpeaker,
  };
}
