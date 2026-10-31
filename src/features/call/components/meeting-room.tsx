"use client";

import { useEffect, useEffectEvent, useState } from "react";
import {
  isTrackReference,
  RoomAudioRenderer,
  RoomContext,
  useAudioPlayback,
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
  useRoomContext,
  useTracks,
  type TrackReference,
} from "@livekit/components-react";
import { ConnectionState, DisconnectReason, Room, RoomEvent, ScreenSharePresets, Track, VideoPresets } from "livekit-client";
import { Loader2, Lock, Volume2, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/shared/features";
import type { CallTokenResponse } from "@/shared/call";
import type { DevicePrefs } from "../device-prefs";
import { describeMediaError, isUserCancel } from "../media-errors";
import { CallControls } from "./call-controls";
import { ParticipantTile } from "./participant-tile";
import { ScreenShareStage } from "./screen-share-stage";

export type LeaveReason = { kind: "left" } | { kind: "duplicate" } | { kind: "removed" } | { kind: "failed"; message: string };

const AUDIO_OPTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

function createRoom() {
  return new Room({
    adaptiveStream: true,
    dynacast: true,
    stopLocalTrackOnUnpublish: true,
    disconnectOnPageLeave: true,
    videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
    audioCaptureDefaults: AUDIO_OPTS,
    publishDefaults: {
      simulcast: true,
      videoCodec: "vp8",
      // Release the mic when muted, so the OS recording indicator turns off too.
      stopMicTrackOnMute: true,
      screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
    },
  });
}

function reasonFor(reason: DisconnectReason | undefined): LeaveReason {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return { kind: "duplicate" };
    case DisconnectReason.PARTICIPANT_REMOVED:
    case DisconnectReason.ROOM_DELETED:
      return { kind: "removed" };
    default:
      return { kind: "failed", message: "The connection dropped and couldn't be restored." };
  }
}

/** Retry without the saved deviceId if that device has gone away. */
async function enableWithFallback(enable: (deviceId?: string) => Promise<unknown>, deviceId: string | undefined) {
  try {
    await enable(deviceId);
  } catch (err) {
    if (!deviceId || isUserCancel(err)) throw err;
    await enable(undefined);
  }
}

export function MeetingRoom({
  connection,
  prefs,
  roomName,
  partnerName,
  onLeave,
}: {
  connection: CallTokenResponse;
  prefs: DevicePrefs;
  roomName: string;
  partnerName: string | null;
  onLeave: (reason: LeaveReason) => void;
}) {
  // The connected Room. A fresh Room is created per effect run: React StrictMode (dev) mounts
  // twice, and a Room that was disconnected mid-connect must never be reused.
  const [room, setRoom] = useState<Room | null>(null);

  const handleDisconnect = useEffectEvent((reason?: DisconnectReason) => {
    if (reason === DisconnectReason.CLIENT_INITIATED) return;
    onLeave(reasonFor(reason));
  });
  const handleFailure = useEffectEvent((message: string) => onLeave({ kind: "failed", message }));

  useEffect(() => {
    let cancelled = false;
    const current = createRoom();
    const onDisconnected = (reason?: DisconnectReason) => {
      if (!cancelled) handleDisconnect(reason);
    };
    current.on(RoomEvent.Disconnected, onDisconnected);

    void (async () => {
      try {
        await current.connect(connection.url, connection.token);
      } catch {
        if (!cancelled) handleFailure("Couldn't reach the call server. Check your connection and try again.");
        return;
      }
      if (cancelled) return;
      setRoom(current);
      if (prefs.speakerId) await current.switchActiveDevice("audiooutput", prefs.speakerId).catch(() => false);
      const lp = current.localParticipant;
      const results = await Promise.allSettled([
        prefs.micOn
          ? enableWithFallback((deviceId) => lp.setMicrophoneEnabled(true, { deviceId, ...AUDIO_OPTS }), prefs.micId)
          : Promise.resolve(),
        prefs.cameraOn
          ? enableWithFallback((deviceId) => lp.setCameraEnabled(true, { deviceId }), prefs.cameraId)
          : Promise.resolve(),
      ]);
      if (cancelled) return;
      results.forEach((r, i) => {
        if (r.status === "rejected") toast.error(describeMediaError(r.reason, i === 0 ? "microphone" : "camera"));
      });
    })();

    return () => {
      cancelled = true;
      current.off(RoomEvent.Disconnected, onDisconnected);
      // Stops every local track, so the camera light goes off on unmount.
      void current.disconnect(true);
      setRoom((r) => (r === current ? null : r));
    };
  }, [connection, prefs]);

  async function leave() {
    await room?.disconnect(true);
    onLeave({ kind: "left" });
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background" data-testid="meeting-room">
      {room ? (
        <RoomContext.Provider value={room}>
          <CallLayout roomName={roomName} partnerName={partnerName} onLeave={leave} />
          <RoomAudioRenderer />
        </RoomContext.Provider>
      ) : (
        <div className="grid flex-1 place-items-center" role="status">
          <span className="flex items-center gap-3 text-lg font-semibold">
            <Loader2 className="size-5 animate-spin text-coral" /> Joining {roomName}…
          </span>
        </div>
      )}
    </div>
  );
}

function CallLayout({ roomName, partnerName, onLeave }: { roomName: string; partnerName: string | null; onLeave: () => void }) {
  const state = useConnectionState();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const remotes = useRemoteParticipants();
  const { canPlayAudio, startAudio } = useAudioPlayback();
  const [modKey] = useState<"Meta" | "Control">(() => (navigator.userAgent.includes("Mac") ? "Meta" : "Control"));
  const partnerLeft = usePartnerLeft();

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const cameras = tracks.filter((t) => t.source === Track.Source.Camera);
  const localCam = cameras.find((t) => t.participant.isLocal);
  const remoteCam = cameras.find((t) => !t.participant.isLocal);
  const share = tracks.find((t): t is TrackReference => t.source === Track.Source.ScreenShare && isTrackReference(t));
  const remote = remotes[0];

  async function toggleMic() {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled, AUDIO_OPTS);
    } catch (err) {
      toast.error(describeMediaError(err, "microphone"));
    }
  }
  async function toggleCam() {
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch (err) {
      toast.error(describeMediaError(err, "camera"));
    }
  }
  async function toggleShare() {
    try {
      await localParticipant.setScreenShareEnabled(!isScreenShareEnabled, {
        audio: true,
        systemAudio: "include",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        contentHint: "detail",
        resolution: { width: 1920, height: 1080, frameRate: 15 },
      });
    } catch (err) {
      if (!isUserCancel(err)) toast.error(describeMediaError(err, "screen"));
    }
  }

  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const key = e.key.toLowerCase();
    if (key === "d") {
      e.preventDefault();
      void toggleMic();
    } else if (key === "e") {
      e.preventDefault();
      void toggleCam();
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onShortcut(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const reconnecting = state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;
  const shareBlockedBy = share && !share.participant.isLocal ? share.participant.name || "Your person" : null;

  return (
    <>
      <header className="flex items-center gap-3 px-4 pt-4 sm:px-6">
        <span className="flex min-w-0 items-center gap-2">
          <Lock className="size-4 shrink-0 text-mint" aria-hidden />
          <h1 className="truncate text-lg font-bold">{roomName}</h1>
        </span>
        <span
          role="status"
          data-testid="connection-state"
          data-state={state}
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
            reconnecting ? "bg-sun/15 text-sun" : "bg-mint/10 text-mint",
          )}
        >
          {reconnecting ? <Loader2 className="size-3.5 animate-spin" /> : <span className="size-2 rounded-full bg-mint" />}
          {reconnecting ? "Reconnecting…" : "Connected"}
        </span>
      </header>

      {reconnecting && (
        <div
          role="alert"
          className="mx-4 mt-3 flex items-center gap-2 rounded-2xl border border-sun/30 bg-sun/10 px-4 py-2 text-sm text-sun sm:mx-6"
        >
          <WifiOff className="size-4" /> Your connection dropped. Reconnecting automatically, hang tight.
        </div>
      )}

      {!canPlayAudio && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-2xl border border-border bg-ink-2 px-4 py-2 text-sm sm:mx-6">
          <span>Your browser paused call audio.</span>
          <Button size="sm" onClick={() => void startAudio()}>
            <Volume2 /> Turn on sound
          </Button>
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-6">
        {share ? (
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_15rem]">
            <ScreenShareStage trackRef={share} onStopLocal={() => void toggleShare()} />
            <div className="flex gap-3 lg:flex-col" aria-label="Cameras">
              {[remoteCam, localCam].map((t) =>
                t ? (
                  <ParticipantTile
                    key={t.participant.identity}
                    trackRef={t}
                    variant="thumb"
                    className="aspect-video w-40 shrink-0 lg:w-full"
                  />
                ) : null,
              )}
            </div>
          </div>
        ) : (
          <div className={cn("grid min-h-0 flex-1 content-center gap-3", "md:grid-cols-2")}>
            {localCam && <ParticipantTile trackRef={localCam} className="aspect-video max-h-full w-full" />}
            {remoteCam ? (
              <ParticipantTile trackRef={remoteCam} className="aspect-video max-h-full w-full" />
            ) : (
              <WaitingTile partnerName={partnerName} left={partnerLeft && !remote} />
            )}
          </div>
        )}
      </main>

      <footer className="flex justify-center px-4 pb-5">
        <CallControls
          micOn={isMicrophoneEnabled}
          camOn={isCameraEnabled}
          sharing={isScreenShareEnabled}
          shareBlockedBy={shareBlockedBy}
          canShare={FEATURES.screenShare}
          modKey={modKey}
          onToggleMic={() => void toggleMic()}
          onToggleCam={() => void toggleCam()}
          onToggleShare={() => void toggleShare()}
          onLeave={onLeave}
        />
      </footer>
    </>
  );
}

/** True once the other person has been in the call and then left. */
function usePartnerLeft() {
  const remotes = useRemoteParticipants();
  const [left, setLeft] = useState(false);
  const room = useRoomContext();
  useEffect(() => {
    const onLeft = () => setLeft(true);
    const onJoined = () => setLeft(false);
    room.on(RoomEvent.ParticipantDisconnected, onLeft);
    room.on(RoomEvent.ParticipantConnected, onJoined);
    return () => {
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
      room.off(RoomEvent.ParticipantConnected, onJoined);
    };
  }, [room]);
  return left && remotes.length === 0;
}

function WaitingTile({ partnerName, left }: { partnerName: string | null; left: boolean }) {
  return (
    <div
      data-testid="waiting-tile"
      className="grid aspect-video w-full place-items-center rounded-[1.75rem] border-2 border-dashed border-ink-4 bg-ink-1/60 p-6 text-center"
    >
      <div className="flex flex-col items-center gap-2">
        <span className="text-4xl" aria-hidden>
          {left ? "👋" : "⏳"}
        </span>
        <p className="font-bold" role="status">
          {left ? `${partnerName ?? "Your person"} left the call` : `Waiting for ${partnerName ?? "your person"} to join…`}
        </p>
        <p className="text-sm text-muted-foreground">
          {left ? "They can rejoin any time. Stay as long as you like." : "They'll pop in here as soon as they join."}
        </p>
      </div>
    </div>
  );
}
