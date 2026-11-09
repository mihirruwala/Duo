"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, type RemoteParticipant } from "livekit-client";
import { toast } from "sonner";
import {
  extensionHas,
  onExtensionMessage,
  sendToExtension,
  useExtensionStatus,
  type BridgeStatus,
} from "@/features/control/extension-bridge";
import type { ExtensionToPage } from "@/shared/control";
import { encodeTabSync, parseTabSync, TAB_SYNC_TOPIC, type TabInfo, type TabSyncMessage } from "@/shared/tab-sync";

export type MySyncedTab = { tab: TabInfo; video: boolean; needsGesture: boolean };
export type TheirSyncedTab = { tab: TabInfo; name: string };

const UNLINK_REASONS: Record<string, string> = {
  tab_closed: "The synced tab was closed.",
  tab_reloaded: "The synced tab reloaded, so syncing stopped. Sync it again from the extension.",
  superseded: "",
  stopped: "",
  extension_disconnected: "",
};

/**
 * Sync a show (any site, each person on their own account). The DUO Control extension runs the
 * sync engine next to the <video> in the tab each person picked; this hook relays its play / pause /
 * seek messages to the other person over LiveKit and back.
 */
export function useTabSync() {
  const room = useRoomContext();
  const extension: BridgeStatus = useExtensionStatus();
  const [mine, setMine] = useState<MySyncedTab | null>(null);
  const [theirs, setTheirs] = useState<TheirSyncedTab | null>(null);
  /** The "pick your tab" dialog: open from Start until the extension reports a synced tab. */
  const [picking, setPicking] = useState(false);
  const mineRef = useRef<MySyncedTab | null>(null);
  useEffect(() => {
    mineRef.current = mine;
  }, [mine]);

  const publish = useCallback(
    (m: TabSyncMessage, to?: string) =>
      room.localParticipant
        .publishData(encodeTabSync(m), {
          reliable: true,
          topic: TAB_SYNC_TOPIC,
          ...(to ? { destinationIdentities: [to] } : {}),
        })
        .catch(() => undefined),
    [room],
  );

  const onExtension = useEffectEvent((msg: ExtensionToPage) => {
    switch (msg.type) {
      case "sync.linked": {
        const first = !mineRef.current;
        const next = {
          tab: msg.tab,
          video: mineRef.current?.video ?? false,
          needsGesture: mineRef.current?.needsGesture ?? false,
        };
        mineRef.current = next;
        setMine(next);
        setPicking(false);
        void publish({ v: 1, t: "linked", tab: msg.tab });
        // Catch up with whoever synced first.
        if (first) void publish({ v: 1, t: "hello" });
        return;
      }
      case "sync.local":
        if (mineRef.current) void publish({ v: 1, t: "state", ...msg.state });
        return;
      case "sync.status":
        setMine((m) => (m ? { ...m, video: msg.video, needsGesture: msg.needsGesture } : m));
        return;
      case "sync.unlinked": {
        if (!mineRef.current) return;
        mineRef.current = null;
        setMine(null);
        void publish({ v: 1, t: "unlinked" });
        const why = UNLINK_REASONS[msg.reason] ?? "Syncing stopped.";
        if (why) toast.info(why);
        return;
      }
    }
  });
  useEffect(() => onExtensionMessage((m) => onExtension(m)), []);

  const onData = useEffectEvent((m: TabSyncMessage, from: RemoteParticipant) => {
    switch (m.t) {
      case "linked":
        setTheirs((prev) => {
          if (!prev && !mineRef.current)
            toast(`${from.name || "Your person"} wants to watch in sync`, { description: m.tab.title || m.tab.host });
          return { tab: m.tab, name: from.name || "Your person" };
        });
        return;
      case "unlinked":
        setTheirs(null);
        return;
      case "state":
        if (mineRef.current)
          sendToExtension({ type: "sync.remote", state: { at: m.at, playing: m.playing, ...(m.hb ? { hb: true } : {}) } });
        return;
      case "hello":
        if (!mineRef.current) return;
        void publish({ v: 1, t: "linked", tab: mineRef.current.tab }, from.identity);
        sendToExtension({ type: "sync.snapshot" });
        return;
    }
  });
  useEffect(() => {
    const handler = (payload: Uint8Array, p?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic !== TAB_SYNC_TOPIC || !p) return;
      const m = parseTabSync(payload);
      if (m) onData(m, p);
    };
    const onJoined = (p: RemoteParticipant) => {
      if (mineRef.current) void publish({ v: 1, t: "linked", tab: mineRef.current.tab }, p.identity);
    };
    const onLeft = () => setTheirs(null);
    room.on(RoomEvent.DataReceived, handler);
    room.on(RoomEvent.ParticipantConnected, onJoined);
    room.on(RoomEvent.ParticipantDisconnected, onLeft);
    return () => {
      room.off(RoomEvent.DataReceived, handler);
      room.off(RoomEvent.ParticipantConnected, onJoined);
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
    };
  }, [room, publish]);

  // After a rejoin this hook mounts fresh while the extension may still be syncing: ask it.
  useEffect(() => {
    if (extension === "connected" && extensionHas("sync")) sendToExtension({ type: "sync.query" });
  }, [extension]);

  // Arm the extension once it's connected while the dialog is open (e.g. right after installing it).
  useEffect(() => {
    if (picking && extension === "connected" && extensionHas("sync")) sendToExtension({ type: "sync.arm" });
  }, [picking, extension]);

  const start = useCallback(() => setPicking(true), []);
  const cancelPick = useCallback(() => setPicking(false), []);
  const stop = useCallback(() => {
    sendToExtension({ type: "sync.stop" });
  }, []);

  return {
    mine,
    theirs,
    picking,
    extension,
    /** Connected, but an older build without "sync". */
    needsUpdate: extension === "connected" && !extensionHas("sync"),
    start,
    cancelPick,
    stop,
  };
}

export type TabSync = ReturnType<typeof useTabSync>;
