"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, type RemoteParticipant } from "livekit-client";
import { toast } from "sonner";
import { encodeWatch, parseWatch, WATCH_TOPIC, type WatchMessage } from "@/shared/watch";
import { WatchSync, type PlaybackState, type SyncPlayer } from "./watch-sync";

export type WatchSession = {
  id: string;
  videoId: string;
  /** Display name of whoever started it ("You" for me). */
  startedBy: string;
  mine: boolean;
  /** Where to begin once the player is ready. */
  initial: PlaybackState;
};

/**
 * Watch Together state for the call. The player itself lives in <WatchStage>, which attaches it
 * here once YouTube is ready; this hook owns the session and the sync messages.
 */
export function useWatchTogether() {
  const room = useRoomContext();
  const [session, setSession] = useState<WatchSession | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const syncRef = useRef<{ id: string; sync: WatchSync } | null>(null);

  const publish = useCallback(
    (m: WatchMessage, to?: string) =>
      room.localParticipant
        .publishData(encodeWatch(m), { reliable: true, topic: WATCH_TOPIC, ...(to ? { destinationIdentities: [to] } : {}) })
        .catch(() => undefined),
    [room],
  );

  const open = useCallback(
    (videoId: string, start = 0) => {
      const id = crypto.randomUUID();
      const prev = session?.id;
      setSession({ id, videoId, startedBy: "You", mine: true, initial: { at: start, playing: true } });
      void publish({ v: 1, t: "open", id, ...(prev ? { prev } : {}), videoId, at: start, playing: true });
    },
    [publish, session?.id],
  );

  const close = useCallback(() => {
    if (!session) return;
    void publish({ v: 1, t: "close", id: session.id });
    setSession(null);
  }, [publish, session]);

  /** Called by <WatchStage> when its YouTube player is ready (and with null when it goes away). */
  const attach = useCallback(
    (id: string, player: SyncPlayer | null) => {
      // A player going away only detaches its own session (never a newer one that already attached).
      if (!player && syncRef.current && syncRef.current.id !== id) return;
      syncRef.current?.sync.dispose();
      syncRef.current = null;
      setNeedsGesture(false);
      if (!player) return;
      const sync = new WatchSync(player, (s) => void publish({ v: 1, t: "state", id, ...s }), {
        driver: false,
        onNeedsGesture: setNeedsGesture,
      });
      syncRef.current = { id, sync };
      return sync;
    },
    [publish],
  );

  const onPlayerState = useCallback((id: string, state: number) => {
    const attached = syncRef.current;
    if (attached?.id === id) attached.sync.onLocalState(state);
  }, []);

  const resume = useCallback(() => syncRef.current?.sync.resumeFromGesture(), []);

  /** Bring someone who just arrived up to the current video and position. */
  const sendCatchUp = useEffectEvent((identity: string) => {
    if (!session) return;
    const attached = syncRef.current;
    const pos = attached?.id === session.id ? attached.sync.snapshot() : session.initial;
    void publish({ v: 1, t: "open", id: session.id, videoId: session.videoId, at: pos.at, playing: pos.playing }, identity);
  });

  const onData = useEffectEvent((m: WatchMessage, from: RemoteParticipant) => {
    const name = from.name || "Your person";
    switch (m.t) {
      case "open": {
        if (session?.id === m.id) return;
        // A different session while I have one: accept it if it replaces mine, or (both started at
        // the same moment) if its id wins the tie-break, so both sides settle on the same video.
        if (session && m.prev !== session.id && m.id < session.id) return;
        setSession({ id: m.id, videoId: m.videoId, startedBy: name, mine: false, initial: { at: m.at, playing: m.playing } });
        // The start and a catch-up reply can arrive together: one toast per session.
        if (!session) toast(`${name} started Watch Together 🍿`, { id: `watch-start-${m.id}` });
        return;
      }
      case "state": {
        if (session?.id !== m.id) return;
        const attached = syncRef.current;
        if (attached?.id === m.id) attached.sync.applyRemote(m);
        else setSession((s) => (s && s.id === m.id ? { ...s, initial: { at: m.at, playing: m.playing } } : s));
        return;
      }
      case "close":
        if (session?.id === m.id) {
          setSession(null);
          toast(`${name} ended Watch Together`, { id: `watch-end-${m.id}` });
        }
        return;
      case "hello":
        if (session) sendCatchUp(from.identity);
        return;
    }
  });

  useEffect(() => {
    const onReceive = (payload: Uint8Array, participant?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic !== WATCH_TOPIC || !participant) return;
      const m = parseWatch(payload);
      if (m) onData(m, participant);
    };
    const onJoined = (p: RemoteParticipant) => sendCatchUp(p.identity);
    room.on(RoomEvent.DataReceived, onReceive);
    room.on(RoomEvent.ParticipantConnected, onJoined);
    // Arriving in a call where something is already playing.
    const hello = setTimeout(() => void publish({ v: 1, t: "hello" }), 800);
    return () => {
      clearTimeout(hello);
      room.off(RoomEvent.DataReceived, onReceive);
      room.off(RoomEvent.ParticipantConnected, onJoined);
    };
  }, [room, publish]);

  // Heartbeats and seek detection.
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => syncRef.current?.sync.tick(), 1000);
    return () => clearInterval(t);
  }, [session]);

  useEffect(() => () => syncRef.current?.sync.dispose(), []);

  return { session, open, close, attach, onPlayerState, needsGesture, resume };
}

export type WatchTogether = ReturnType<typeof useWatchTogether>;
