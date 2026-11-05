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
  useIsEncrypted,
  useRoomContext,
  useTracks,
  type TrackReference,
} from "@livekit/components-react";
import {
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
  VideoPreset,
  VideoPresets,
  AudioPresets,
  ExternalE2EEKeyProvider,
  type LocalVideoTrack,
  type RemoteParticipant,
} from "livekit-client";
import { Loader2, Lock, PictureInPicture2, ShieldCheck, Volume2, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/shared/features";
import type { CallTokenResponse } from "@/shared/call";
import type { DevicePrefs } from "../device-prefs";
import { describeMediaError, isUserCancel } from "../media-errors";
import { ControlProvider, useControl } from "@/features/control/control-provider";
import { ControllerBar, OwnerControlLayer } from "@/features/control/components/control-ui";
import { InputCapture } from "@/features/control/components/input-capture";
import { CONTROLLABLE_TRACK_NAME } from "@/shared/control";
import { PerfBadge, StudioPanel } from "@/features/studio/components/studio-panel";
import { useStudioTrack } from "@/features/studio/use-studio-track";
import { isStudioActive } from "@/shared/studio";
import { CallFunOverlay, useCallFun } from "../fun/call-fun";
import { CallPip, pipSupported, useCallPip } from "../pip/call-pip";
import { CallControls } from "./call-controls";
import { CallStage, useCallPin, type StageContent } from "./call-stage";
import { useWatchTogether } from "../watch/use-watch-together";
import { WatchDialog } from "../watch/watch-dialog";
import { WatchStage } from "../watch/watch-stage";
import { WATCH_SHARE_TRACK } from "@/shared/watch";
import { useAnnounceCall, useWatchSuggestions, WATCH_EVENT, type WatchRequest } from "../watch/watch-events";
import { ScreenShareStage } from "./screen-share-stage";

export type LeaveReason = { kind: "left" } | { kind: "duplicate" } | { kind: "removed" } | { kind: "failed"; message: string };

const AUDIO_OPTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/** With a media key, audio/video are encrypted in the browser; LiveKit only relays ciphertext. */
function createRoom(e2ee: { keyProvider: ExternalE2EEKeyProvider; worker: Worker } | null) {
  return new Room({
    ...(e2ee ? { e2ee } : {}),
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
  roomId,
  connection,
  prefs,
  roomName,
  partnerName,
  onLeave,
  onRejoinNeeded,
  rejoining = false,
}: {
  roomId: string;
  connection: CallTokenResponse;
  prefs: DevicePrefs;
  roomName: string;
  partnerName: string | null;
  onLeave: (reason: LeaveReason) => void;
  /**
   * The connection can't be trusted any more (LiveKit fell back to a full rejoin under a new
   * participant id, which can drop the other person's tracks, or it disconnected unexpectedly).
   * The parent fetches a fresh token and remounts us with a brand-new Room.
   */
  onRejoinNeeded: () => void;
  rejoining?: boolean;
}) {
  // The connected Room. A fresh Room is created per effect run: React StrictMode (dev) mounts
  // twice, and a Room that was disconnected mid-connect must never be reused.
  const [room, setRoom] = useState<Room | null>(null);

  const handleDisconnect = useEffectEvent((reason?: DisconnectReason) => {
    if (reason === DisconnectReason.CLIENT_INITIATED) return;
    const r = reasonFor(reason);
    // Network trouble is recoverable: try a clean rejoin before giving up.
    if (r.kind === "failed") onRejoinNeeded();
    else onLeave(r);
  });
  const handleFullReconnect = useEffectEvent(() => onRejoinNeeded());
  const handleFailure = useEffectEvent((message: string) => onLeave({ kind: "failed", message }));

  useEffect(() => {
    let cancelled = false;
    let e2ee: { keyProvider: ExternalE2EEKeyProvider; worker: Worker } | null = null;
    if (connection.e2eeKey) {
      e2ee = { keyProvider: new ExternalE2EEKeyProvider(), worker: new Worker("/livekit/e2ee-worker.js", { name: "duo-e2ee" }) };
    }
    const current = createRoom(e2ee);
    const onDisconnected = (reason?: DisconnectReason) => {
      if (!cancelled) handleDisconnect(reason);
    };
    current.on(RoomEvent.Disconnected, onDisconnected);

    void (async () => {
      try {
        if (e2ee && connection.e2eeKey) {
          // Random 32-byte key → HKDF inside LiveKit's worker.
          await e2ee.keyProvider.setKey(Uint8Array.from(atob(connection.e2eeKey), (ch) => ch.charCodeAt(0)).buffer);
          await current.setE2EEEnabled(true);
        }
        // The awaits above give React time to unmount us (StrictMode, or a rejoin). Never connect a
        // discarded Room: its late join would kick the live one out as a "duplicate identity".
        if (cancelled) return;
        await current.connect(connection.url, connection.token);
      } catch {
        if (!cancelled) handleFailure("Couldn't reach the call server. Check your connection and try again.");
        return;
      }
      if (cancelled) return;
      setRoom(current);
      // Reconnect health: LiveKit can report "connected" after a long outage while the other person's
      // tracks were dropped (full rejoin under a new participant id, or a resume that lost them).
      // If that happens, rejoin cleanly instead of leaving a frozen call.
      const firstSid = current.localParticipant.sid;
      current.on(RoomEvent.ConnectionStateChanged, (state) => {
        if (!cancelled && state === ConnectionState.Connected && current.localParticipant.sid !== firstSid) handleFullReconnect();
      });
      current.on(RoomEvent.Reconnected, () => {
        setTimeout(() => {
          if (cancelled || current.state !== ConnectionState.Connected) return;
          const missing = Array.from(current.remoteParticipants.values()).some((p) =>
            Array.from(p.trackPublications.values()).some(
              (pub) =>
                (pub.source === Track.Source.Camera || pub.source === Track.Source.Microphone) &&
                !pub.isMuted &&
                !pub.isSubscribed,
            ),
          );
          if (missing) handleFullReconnect();
        }, 6000);
      });
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
      void current.disconnect(true).finally(() => e2ee?.worker.terminate());
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
          <ControlProvider roomId={roomId}>
            <CallLayout roomName={roomName} partnerName={partnerName} onLeave={leave} />
            {FEATURES.remoteControl && <OwnerControlLayer />}
          </ControlProvider>
          <RoomAudioRenderer />
        </RoomContext.Provider>
      ) : (
        <div className="grid flex-1 place-items-center" role="status">
          <span className="flex items-center gap-3 text-lg font-semibold">
            <Loader2 className="size-5 animate-spin text-coral" /> {rejoining ? "Reconnecting to" : "Joining"} {roomName}…
          </span>
        </div>
      )}
    </div>
  );
}

function CallLayout({ roomName, partnerName, onLeave }: { roomName: string; partnerName: string | null; onLeave: () => void }) {
  const state = useConnectionState();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled, cameraTrack } = useLocalParticipant();
  const cameraVideo = cameraTrack?.track as LocalVideoTrack | undefined;
  const studio = useStudioTrack(FEATURES.studio ? cameraVideo : undefined);
  const [studioOpen, setStudioOpen] = useState(false);
  const remotes = useRemoteParticipants();
  const { canPlayAudio, startAudio } = useAudioPlayback();
  const [modKey] = useState<"Meta" | "Control">(() => (navigator.userAgent.includes("Mac") ? "Meta" : "Control"));
  const partnerLeft = usePartnerLeft();
  const control = useControl();
  const pip = useCallPip();
  const fun = useCallFun();
  const [pin, setPin] = useCallPin();
  const watch = useWatchTogether();
  const [watchDialog, setWatchDialog] = useState(false);
  const watchSuggestions = useWatchSuggestions();
  useAnnounceCall();

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
    // A tab shared through the extension is stopped via the control layer (it also tells the extension).
    if (isScreenShareEnabled && control.sharingControllable) return control.stopControllableShare();
    // One thing on the big screen at a time: sharing ends Watch Together.
    if (!isScreenShareEnabled && watch.session) watch.close();
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

  // "Watch now" on a YouTube link in a shared list.
  const onWatchRequest = useEffectEvent((req: WatchRequest) => {
    if (share) return void toast.error("Stop the screen share first, then start Watch Together.");
    watch.open(req.videoId, req.start);
  });
  useEffect(() => {
    const handler = (e: Event) => onWatchRequest((e as CustomEvent<WatchRequest>).detail);
    window.addEventListener(WATCH_EVENT, handler);
    return () => window.removeEventListener(WATCH_EVENT, handler);
  }, []);

  /**
   * Watch mode: share a tab playing a show. Tuned for motion (30 fps, high bitrate, stereo sound
   * straight from the tab) rather than for crisp text like a normal screen share.
   */
  async function startWatchShare() {
    if (watch.session) watch.close();
    // Chrome normally jumps to the shared tab; stay here so the sharer can pop out their person's
    // face first (that needs a click on this page), then switch to the show.
    let controller: { setFocusBehavior?: (b: string) => void } | undefined;
    const Ctor = (window as unknown as { CaptureController?: new () => { setFocusBehavior?: (b: string) => void } })
      .CaptureController;
    if (Ctor) {
      controller = new Ctor();
      try {
        controller.setFocusBehavior?.("no-focus-change");
      } catch {
        // Older Chrome: it switches tabs, the sharer can still use Pop out from the header.
      }
    }
    try {
      await localParticipant.setScreenShareEnabled(
        true,
        {
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
          video: { displaySurface: "browser" },
          systemAudio: "include",
          selfBrowserSurface: "exclude",
          surfaceSwitching: "include",
          contentHint: "motion",
          resolution: { width: 1920, height: 1080, frameRate: 30 },
          ...(controller ? { controller } : {}),
        },
        {
          name: WATCH_SHARE_TRACK,
          screenShareEncoding: { maxBitrate: 6_000_000, maxFramerate: 30, priority: "high" },
          screenShareSimulcastLayers: [new VideoPreset(1280, 720, 2_000_000, 30)],
          degradationPreference: "maintain-framerate",
          audioPreset: AudioPresets.musicHighQualityStereo,
          dtx: false,
          forceStereo: true,
        },
      );
      setPin(null); // the show takes the big spot
      if (!localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)) {
        toast.warning("No sound is being shared", {
          description: "Pick a Chrome tab (not a window) and keep “Also share tab audio” on.",
          duration: 10_000,
        });
      }
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

  // When a show starts (Watch Together or a Watch-mode share), it takes the big spot, even if a
  // person was pinned. Pinning again afterwards works as usual.
  const watchingKey =
    share && share.publication.trackName === WATCH_SHARE_TRACK
      ? `share:${share.publication.trackSid}`
      : !share && watch.session
        ? `watch:${watch.session.id}`
        : null;
  useEffect(() => {
    if (watchingKey) setPin(null);
  }, [watchingKey, setPin]);

  const stageContent: StageContent | null = share
    ? {
        key: `share:${share.publication.trackSid}`,
        render: ({ compact, style, onActivate }) => (
          <ScreenShareStage
            trackRef={share}
            compact={compact}
            style={style}
            onActivate={onActivate}
            onStopLocal={() => void toggleShare()}
            localTitle={control.sharingControllable ? control.sharedTabTitle : null}
            watchMode={share.publication.trackName === WATCH_SHARE_TRACK}
            partnerName={partnerName}
            onPopOut={pipSupported() && !pip.pipWindow ? () => void pip.open() : undefined}
            renderOverlay={(container) =>
              FEATURES.remoteControl && !share.participant.isLocal && share.publication.trackName === CONTROLLABLE_TRACK_NAME ? (
                <>
                  {control.control.phase === "active" && control.control.role === "controller" && (
                    <InputCapture
                      videoContainer={container}
                      onInput={control.sendInput}
                      name={share.participant.name || "your person"}
                    />
                  )}
                  <ControllerBar ownerName={share.participant.name || "Your person"} />
                </>
              ) : null
            }
          />
        ),
      }
    : watch.session
      ? {
          key: `watch:${watch.session.id}`,
          render: ({ compact, style, onActivate }) => (
            <WatchStage
              watch={watch}
              compact={compact}
              style={style}
              onActivate={onActivate}
              onChangeVideo={() => setWatchDialog(true)}
            />
          ),
        }
      : null;

  const reconnecting = state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;
  const shareBlockedBy = share && !share.participant.isLocal ? share.participant.name || "Your person" : null;

  return (
    <>
      <header className="flex items-center gap-3 px-4 pt-4 sm:px-6">
        <span className="flex min-w-0 items-center gap-2">
          <Lock className="size-4 shrink-0 text-mint" aria-hidden />
          <h1 className="truncate text-lg font-bold">{roomName}</h1>
        </span>
        <EncryptionBadge />
        {pipSupported() && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => void (pip.pipWindow ? pip.close() : pip.open())}
            aria-pressed={!!pip.pipWindow}
            data-testid="pop-out"
          >
            <PictureInPicture2 /> {pip.pipWindow ? "Close mini window" : "Pop out"}
          </Button>
        )}
        <span
          role="status"
          data-testid="connection-state"
          data-state={state}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
            !pipSupported() && "ml-auto",
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
        <CallStage
          localCam={localCam}
          remoteCam={remoteCam}
          waiting={<WaitingTile partnerName={partnerName} left={partnerLeft && !remote} />}
          pin={pin}
          onPin={setPin}
          content={stageContent}
        />
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
          onShareWatch={() => void startWatchShare()}
          onShareControllable={
            FEATURES.remoteControl
              ? () => {
                  // You're about to switch tabs: keep your person and Revoke visible on top.
                  void pip.open();
                  if (watch.session) watch.close();
                  control.startControllableShare();
                }
              : undefined
          }
          onOpenStudio={FEATURES.studio ? () => setStudioOpen(true) : undefined}
          effectsOn={isStudioActive(studio.config)}
          onReact={fun.react}
          onPhotoBooth={fun.canBooth ? fun.startBooth : undefined}
          onWatch={() => setWatchDialog(true)}
          watching={!!watch.session}
          watchBlockedBy={share ? "Stop the screen share to watch together" : null}
          onLeave={onLeave}
        />
      </footer>
      <WatchDialog
        open={watchDialog}
        onOpenChange={setWatchDialog}
        changing={!!watch.session}
        suggestions={watchSuggestions}
        onStart={(videoId, start) => watch.open(videoId, start)}
        onShareTab={share ? undefined : () => void startWatchShare()}
      />
      <CallPip pipWindow={pip.pipWindow} />
      <CallFunOverlay fun={fun} />
      {FEATURES.studio && <StudioPanel open={studioOpen} onOpenChange={setStudioOpen} track={cameraVideo} stats={studio.stats} />}
      <PerfBadge stats={studio.stats} className="fixed top-16 left-4 z-50" />
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

/** Shown only when LiveKit reports every participant's media as end-to-end encrypted. */
function EncryptionBadge() {
  const { localParticipant } = useLocalParticipant();
  const remote = useRemoteParticipants()[0];
  const localEncrypted = useIsEncrypted(localParticipant);
  if (!localEncrypted) return null;
  // LiveKit's hook throws without a participant, so the remote check only mounts once someone's here.
  return remote ? <RemoteEncrypted participant={remote} /> : <Badge />;
}

function RemoteEncrypted({ participant }: { participant: RemoteParticipant }) {
  return useIsEncrypted(participant) ? <Badge /> : null;
}

function Badge() {
  return (
    <span
      className="hidden items-center gap-1 rounded-full bg-mint/10 px-2.5 py-1 text-xs font-semibold text-mint sm:flex"
      title="Audio and video are encrypted on your devices; DUO's media server only relays ciphertext."
      data-testid="e2ee-badge"
    >
      <ShieldCheck className="size-3.5" aria-hidden /> End-to-end encrypted
    </span>
  );
}
