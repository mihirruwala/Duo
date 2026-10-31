"use client";

import { createContext, use, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useLocalParticipant, useRemoteParticipants, useRoomContext, useTracks } from "@livekit/components-react";
import { RoomEvent, ScreenSharePresets, Track, type LocalTrackPublication, type RemoteParticipant } from "livekit-client";
import { toast } from "sonner";
import { getBrowserClient } from "@/lib/supabase/client";
import {
  CONTROL_TOPIC,
  CONTROLLABLE_TRACK_NAME,
  encodePeerMessage,
  endReasonText,
  parsePeerMessage,
  PROTOCOL_VERSION,
  type InputEvent,
  type PeerMessage,
} from "@/shared/control";
import type { ControlStatus } from "@/shared/database";
import { friendlyError } from "@/shared/errors";
import { onExtensionMessage, sendToExtension, useExtensionStatus, type BridgeStatus } from "./extension-bridge";

export type ControlPhase =
  | { phase: "idle" }
  | { phase: "requesting"; sessionId: string } // controller: waiting for approval
  | { phase: "incoming"; sessionId: string; controllerId: string; controllerName: string } // owner: decide
  | { phase: "starting"; sessionId: string; controllerId: string; controllerName: string } // owner: extension attaching
  | { phase: "active"; role: "owner" | "controller"; sessionId: string; peerId: string; peerName: string; expiresAt: number };

type ControlApi = {
  control: ControlPhase;
  extension: BridgeStatus;
  /** Owner: a tab is being shared through the extension (and so can be controlled). */
  sharingControllable: boolean;
  sharedTabTitle: string;
  /** Owner: instructions dialog for picking the tab in the extension popup. */
  awaitingTabPick: boolean;
  startControllableShare: () => void;
  cancelTabPick: () => void;
  stopControllableShare: () => void;
  approve: () => Promise<void>;
  deny: () => Promise<void>;
  revoke: (reason?: string) => void;
  requestControl: () => Promise<void>;
  cancelRequest: () => void;
  release: () => void;
  sendInput: (e: InputEvent) => void;
};

const ControlContext = createContext<ControlApi | null>(null);
export function useControl(): ControlApi {
  const ctx = use(ControlContext);
  if (!ctx) throw new Error("useControl must be used inside <ControlProvider>");
  return ctx;
}

const db = () => getBrowserClient();

/** Audit-log transition. Failures are reported but never block stopping control. */
async function audit(sessionId: string, status: ControlStatus, reason?: string) {
  const { error } = await db().rpc("control_transition", { p_session_id: sessionId, p_status: status, p_reason: reason });
  return error;
}

function auditEnd(sessionId: string, reason: string) {
  const status: ControlStatus =
    reason === "expired" ? "expired" : reason === "owner_revoked" || reason === "emergency_stop" ? "revoked" : "ended";
  void audit(sessionId, status, reason);
}

export function ControlProvider({ roomId, children }: { roomId: string; children: React.ReactNode }) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const remotes = useRemoteParticipants();
  const extension = useExtensionStatus();
  const [control, setControl] = useState<ControlPhase>({ phase: "idle" });
  const [awaitingTabPick, setAwaitingTabPick] = useState(false);
  const [sharedTabTitle, setSharedTabTitle] = useState("");
  const controllablePub = useRef<LocalTrackPublication | null>(null);
  const [sharingControllable, setSharingControllable] = useState(false);
  const seq = useRef(0);
  const controlRef = useRef(control);
  useEffect(() => {
    controlRef.current = control;
  });

  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const remoteControllableShare = screenTracks.find(
    (t) => !t.participant.isLocal && t.publication.trackName === CONTROLLABLE_TRACK_NAME,
  );

  const sendPeer = useCallback(
    (msg: PeerMessage, to: string) => {
      void localParticipant
        .publishData(encodePeerMessage(msg), { reliable: true, topic: CONTROL_TOPIC, destinationIdentities: [to] })
        .catch(() => undefined);
    },
    [localParticipant],
  );

  const peerName = (identity: string) => room.remoteParticipants.get(identity)?.name || "Your person";

  // ── Owner: controllable tab share ──────────────────────────────────────

  const unpublishControllable = useCallback(async () => {
    const pub = controllablePub.current;
    controllablePub.current = null;
    setSharingControllable(false);
    setSharedTabTitle("");
    if (pub?.track) {
      await localParticipant.unpublishTrack(pub.track, true).catch(() => undefined);
    }
  }, [localParticipant]);

  /** End an owner-side session everywhere: extension first (fail-safe), then peer, then audit log. */
  const endOwnerSession = useCallback(
    (reason: string, opts: { notifyExtension: boolean }) => {
      const c = controlRef.current;
      if (c.phase === "idle" || c.phase === "requesting") return;
      if (c.phase === "active" && c.role === "controller") return;
      if (opts.notifyExtension) sendToExtension({ type: "control.stop", sessionId: c.sessionId, reason });
      sendToExtension({ type: "approval.dismiss", sessionId: c.sessionId });
      const peer = c.phase === "active" ? c.peerId : c.controllerId;
      sendPeer(
        { v: PROTOCOL_VERSION, t: c.phase === "incoming" ? "deny" : "end", sessionId: c.sessionId, reason } as PeerMessage,
        peer,
      );
      if (c.phase === "incoming") void audit(c.sessionId, "denied", reason);
      else auditEnd(c.sessionId, reason);
      setControl({ phase: "idle" });
    },
    [sendPeer],
  );

  const stopControllableShare = useCallback(() => {
    endOwnerSession("share_stopped", { notifyExtension: true });
    sendToExtension({ type: "share.stopped" });
    void unpublishControllable();
  }, [endOwnerSession, unpublishControllable]);

  const approve = useCallback(async () => {
    const c = controlRef.current;
    if (c.phase !== "incoming") return;
    sendToExtension({ type: "approval.dismiss", sessionId: c.sessionId });
    const { data, error } = await db().rpc("control_transition", { p_session_id: c.sessionId, p_status: "approved" });
    if (error || !data) {
      toast.error(friendlyError(error, "Couldn't approve. Try again."));
      setControl({ phase: "idle" });
      sendPeer({ v: PROTOCOL_VERSION, t: "deny", sessionId: c.sessionId }, c.controllerId);
      return;
    }
    setControl({ phase: "starting", sessionId: c.sessionId, controllerId: c.controllerId, controllerName: c.controllerName });
    const expiresAt = data.expires_at ? Date.parse(data.expires_at) : Date.now() + 15 * 60_000;
    if (
      !sendToExtension({
        type: "control.start",
        sessionId: c.sessionId,
        controllerName: c.controllerName.slice(0, 40),
        expiresAt,
      })
    ) {
      toast.error("The DUO extension isn't connected.");
      endOwnerSession("extension_disconnected", { notifyExtension: false });
    }
  }, [endOwnerSession, sendPeer]);

  const deny = useCallback(async () => {
    const c = controlRef.current;
    if (c.phase !== "incoming") return;
    sendToExtension({ type: "approval.dismiss", sessionId: c.sessionId });
    sendPeer({ v: PROTOCOL_VERSION, t: "deny", sessionId: c.sessionId }, c.controllerId);
    setControl({ phase: "idle" });
    await audit(c.sessionId, "denied");
  }, [sendPeer]);

  const onExtMessage = useEffectEvent(async (msg: Parameters<Parameters<typeof onExtensionMessage>[0]>[0]) => {
    switch (msg.type) {
      case "share.ready": {
        setAwaitingTabPick(false);
        try {
          // The stream id is bound by Chrome to this tab + the exact tab the owner picked in the popup.
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: msg.streamId, maxFrameRate: 30 } },
          } as unknown as MediaStreamConstraints);
          const track = stream.getVideoTracks()[0];
          if (!track) throw new Error("no track");
          if (controllablePub.current?.track) await localParticipant.unpublishTrack(controllablePub.current.track, true);
          // One share at a time: a regular screen share gives way.
          if (localParticipant.isScreenShareEnabled) await localParticipant.setScreenShareEnabled(false);
          track.contentHint = "detail";
          track.addEventListener("ended", () => stopControllableShare());
          controllablePub.current = await localParticipant.publishTrack(track, {
            source: Track.Source.ScreenShare,
            name: CONTROLLABLE_TRACK_NAME,
            simulcast: false,
            screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
          });
          setSharingControllable(true);
          setSharedTabTitle(msg.tabTitle);
          toast.success(`Sharing “${msg.tabTitle || "your tab"}”. Your person can now ask for control.`);
        } catch {
          sendToExtension({ type: "share.stopped" });
          toast.error("Couldn't start sharing that tab. Try again from the extension.");
        }
        return;
      }
      case "share.cleared":
        if (msg.reason !== "share_stopped") toast.info(endReasonText(msg.reason));
        endOwnerSession(msg.reason, { notifyExtension: false });
        void unpublishControllable();
        return;
      case "control.started": {
        const c = controlRef.current;
        if (c.phase !== "starting" || c.sessionId !== msg.sessionId) return;
        const { data, error } = await db().from("control_sessions").select("expires_at").eq("id", c.sessionId).single();
        const expiresAt = data?.expires_at ? Date.parse(data.expires_at) : Date.now() + 15 * 60_000;
        if (error) toast.error("Control started, but the audit log couldn't be read.");
        setControl({
          phase: "active",
          role: "owner",
          sessionId: c.sessionId,
          peerId: c.controllerId,
          peerName: c.controllerName,
          expiresAt,
        });
        sendPeer({ v: PROTOCOL_VERSION, t: "approve", sessionId: c.sessionId, expiresAt }, c.controllerId);
        return;
      }
      case "control.error": {
        const c = controlRef.current;
        if (c.phase !== "starting" || c.sessionId !== msg.sessionId) return;
        toast.error(msg.message);
        endOwnerSession("extension_error", { notifyExtension: false });
        return;
      }
      case "control.ended": {
        const c = controlRef.current;
        if ((c.phase === "active" && c.role === "owner") || c.phase === "starting") {
          if (c.sessionId !== msg.sessionId) return;
          toast.info(endReasonText(msg.reason));
          endOwnerSession(msg.reason, { notifyExtension: false });
        }
        return;
      }
      case "approval.response":
        if (controlRef.current.phase === "incoming" && controlRef.current.sessionId === msg.sessionId) {
          // Effect events always see the latest render, so these are current.
          if (msg.approved) await approve();
          else await deny();
        }
        return;
      case "emergency.stop":
        return; // control.ended (reason emergency_stop) already handled it
    }
  });

  useEffect(() => onExtensionMessage((m) => void onExtMessage(m)), []);

  // ── Peer messages ──────────────────────────────────────────────────────

  const onPeer = useEffectEvent(async (msg: PeerMessage, from: string) => {
    const c = controlRef.current;
    switch (msg.t) {
      case "request": {
        if (!controllablePub.current) {
          sendPeer({ v: PROTOCOL_VERSION, t: "deny", sessionId: msg.sessionId }, from);
          return;
        }
        // Trust the database, not the message: the row must be a live request from this exact sender to me.
        const { data } = await db().from("control_sessions").select("*").eq("id", msg.sessionId).maybeSingle();
        if (
          !data ||
          data.status !== "requested" ||
          data.controller_id !== from ||
          data.owner_id !== localParticipant.identity ||
          data.room_id !== roomId
        )
          return;
        if (c.phase === "active" || c.phase === "starting") endOwnerSession("superseded", { notifyExtension: true });
        const name = peerName(from);
        setControl({ phase: "incoming", sessionId: msg.sessionId, controllerId: from, controllerName: name });
        sendToExtension({ type: "approval.request", sessionId: msg.sessionId, controllerName: name });
        return;
      }
      case "input":
        // Owner gate: approved session, from the approved controller, not expired. The extension re-validates.
        if (c.phase === "active" && c.role === "owner" && c.sessionId === msg.sessionId && c.peerId === from) {
          if (Date.now() >= c.expiresAt) return endOwnerSession("expired", { notifyExtension: true });
          sendToExtension({ type: "input", sessionId: msg.sessionId, seq: msg.seq, e: msg.e });
        }
        return;
      case "end":
        if ((c.phase === "active" || c.phase === "incoming" || c.phase === "starting") && c.sessionId === msg.sessionId) {
          if (c.phase === "active" && c.role === "controller") {
            toast.info(endReasonText(msg.reason));
            setControl({ phase: "idle" });
          } else {
            // Controller released or cancelled.
            if (c.phase !== "incoming") sendToExtension({ type: "control.stop", sessionId: c.sessionId, reason: msg.reason });
            sendToExtension({ type: "approval.dismiss", sessionId: c.sessionId });
            setControl({ phase: "idle" });
            if (msg.reason === "released") toast.info(`${peerName(from)} handed control back.`);
          }
        } else if (c.phase === "requesting" && c.sessionId === msg.sessionId) {
          toast.info(endReasonText(msg.reason));
          setControl({ phase: "idle" });
        }
        return;
      case "approve":
        if (c.phase === "requesting" && c.sessionId === msg.sessionId) {
          setControl({
            phase: "active",
            role: "controller",
            sessionId: msg.sessionId,
            peerId: from,
            peerName: peerName(from),
            expiresAt: msg.expiresAt,
          });
          toast.success("You're in control. Click the shared screen to start.");
        }
        return;
      case "deny":
        if (c.phase === "requesting" && c.sessionId === msg.sessionId) {
          toast.info(`${peerName(from)} declined the request.`);
          setControl({ phase: "idle" });
        }
        return;
    }
  });

  useEffect(() => {
    const handler = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== CONTROL_TOPIC || !participant) return; // sender identity comes from the SFU, not the payload
      const msg = parsePeerMessage(payload);
      if (msg) void onPeer(msg, participant.identity);
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => {
      room.off(RoomEvent.DataReceived, handler);
    };
  }, [room]);

  // ── Owner actions ──────────────────────────────────────────────────────

  const revoke = useCallback((reason = "owner_revoked") => endOwnerSession(reason, { notifyExtension: true }), [endOwnerSession]);

  // Expiry on the owner side (the extension enforces it too).
  useEffect(() => {
    if (control.phase !== "active" || control.role !== "owner") return;
    const t = setTimeout(
      () => endOwnerSession("expired", { notifyExtension: true }),
      Math.max(0, control.expiresAt - Date.now()),
    );
    return () => clearTimeout(t);
  }, [control, endOwnerSession]);

  // In-page emergency stop (the extension's global shortcut also works outside Chrome).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "9" || e.code === "Digit9")) {
        const c = controlRef.current;
        if (c.phase === "active" && c.role === "owner") {
          e.preventDefault();
          revoke("emergency_stop");
          toast.success("Remote control stopped.");
        }
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [revoke]);

  // ── Controller actions ─────────────────────────────────────────────────

  const ownerId = remoteControllableShare?.participant.identity;

  const requestControl = useCallback(async () => {
    if (!ownerId) return;
    const { data, error } = await db().rpc("control_request", { p_room_id: roomId });
    if (error || !data) return void toast.error(friendlyError(error, "Couldn't send the request."));
    seq.current = 0;
    setControl({ phase: "requesting", sessionId: data.id });
    sendPeer({ v: PROTOCOL_VERSION, t: "request", sessionId: data.id }, ownerId);
  }, [ownerId, roomId, sendPeer]);

  const cancelRequest = useCallback(() => {
    const c = controlRef.current;
    if (c.phase !== "requesting") return;
    if (ownerId) sendPeer({ v: PROTOCOL_VERSION, t: "end", sessionId: c.sessionId, reason: "cancelled" }, ownerId);
    void audit(c.sessionId, "ended", "cancelled");
    setControl({ phase: "idle" });
  }, [ownerId, sendPeer]);

  const release = useCallback(() => {
    const c = controlRef.current;
    if (c.phase !== "active" || c.role !== "controller") return;
    sendPeer({ v: PROTOCOL_VERSION, t: "end", sessionId: c.sessionId, reason: "released" }, c.peerId);
    void audit(c.sessionId, "ended", "released");
    setControl({ phase: "idle" });
  }, [sendPeer]);

  const sendInput = useCallback(
    (e: InputEvent) => {
      const c = controlRef.current;
      if (c.phase !== "active" || c.role !== "controller") return;
      if (Date.now() >= c.expiresAt) {
        setControl({ phase: "idle" });
        toast.info(endReasonText("expired"));
        return;
      }
      sendPeer({ v: PROTOCOL_VERSION, t: "input", sessionId: c.sessionId, seq: ++seq.current, e }, c.peerId);
    },
    [sendPeer],
  );

  // Controller: the controllable share disappeared (owner stopped sharing / left) → control is over.
  useEffect(() => {
    const c = controlRef.current;
    if (!remoteControllableShare && (c.phase === "requesting" || (c.phase === "active" && c.role === "controller"))) {
      const t = setTimeout(() => setControl({ phase: "idle" }), 0);
      return () => clearTimeout(t);
    }
  }, [remoteControllableShare]);

  // Owner: the controller left the call → end the session.
  const peerPresent = useMemo(() => new Set(remotes.map((r) => r.identity)), [remotes]);
  useEffect(() => {
    const c = controlRef.current;
    const peer = c.phase === "active" ? c.peerId : c.phase === "incoming" || c.phase === "starting" ? c.controllerId : null;
    if (peer && !peerPresent.has(peer)) {
      const t = setTimeout(() => {
        if (c.phase === "active" && c.role === "controller") setControl({ phase: "idle" });
        else endOwnerSession("peer_left", { notifyExtension: true });
      }, 0);
      return () => clearTimeout(t);
    }
  }, [peerPresent, endOwnerSession]);

  // Leaving the call (unmount) must end any session and the controllable share.
  useEffect(
    () => () => {
      const c = controlRef.current;
      if (c.phase === "active" || c.phase === "starting" || c.phase === "incoming") {
        if (c.phase === "active" && c.role === "controller") return;
        sendToExtension({ type: "control.stop", sessionId: c.sessionId, reason: "peer_left" });
        auditEnd(c.sessionId, "peer_left");
      }
      if (controllablePub.current) sendToExtension({ type: "share.stopped" });
    },
    [],
  );

  const api: ControlApi = {
    control,
    extension,
    sharingControllable,
    sharedTabTitle,
    awaitingTabPick,
    startControllableShare: () => setAwaitingTabPick(true),
    cancelTabPick: () => setAwaitingTabPick(false),
    stopControllableShare,
    approve,
    deny,
    revoke,
    requestControl,
    cancelRequest,
    release,
    sendInput,
  };
  return <ControlContext value={api}>{children}</ControlContext>;
}
