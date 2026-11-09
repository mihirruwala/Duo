"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DoorOpen, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatProvider, useMaybeChat, type Person } from "@/features/chat/chat-provider";
import { usePresenceAlerts } from "@/features/presence/use-presence-alerts";
import { ChatDock } from "@/features/chat/components/chat-dock";
import { ListsProvider } from "@/features/lists/lists-provider";
import { FEATURES } from "@/shared/features";
import { callTokenResponseSchema, type CallTokenResponse } from "@/shared/call";
import type { DevicePrefs } from "../device-prefs";
import { PhoneSheet } from "@/components/duo/phone-sheet";
import { setPhoneSheet, usePhoneSheet } from "@/features/rooms/phone-room-store";
import { usePhone } from "@/lib/use-phone";
import { MeetingRoom, type LeaveReason } from "./meeting-room";
import { PreCallStudio } from "./pre-call-studio";

type Phase =
  | { kind: "precall" }
  | { kind: "call"; connection: CallTokenResponse; prefs: DevicePrefs }
  | { kind: "ended"; reason: LeaveReason };

type Props = {
  slug: string;
  roomId: string;
  roomName: string;
  me: Person;
  partner: Person | null;
  gifsEnabled: boolean;
  /** Server-rendered room details shown beside the pre-call studio. */
  aside?: React.ReactNode;
};

async function fetchToken(slug: string): Promise<CallTokenResponse> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(slug)}/token`, { method: "POST", credentials: "same-origin" });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : "Couldn't join the call.";
    throw new Error(res.status === 401 ? "Your session expired. Sign in again to join." : message);
  }
  const parsed = callTokenResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error("Couldn't join the call.");
  return parsed.data;
}

export function RoomExperience({ slug, roomId, roomName, me, partner, gifsEnabled, aside }: Props) {
  const content = <RoomPhases slug={slug} roomId={roomId} roomName={roomName} me={me} partner={partner} aside={aside} />;
  if (!FEATURES.chat) return content;
  return (
    <ChatProvider roomId={roomId} slug={slug} me={me} partner={partner}>
      <ListsProvider roomId={roomId}>
        {content}
        <ChatDock roomId={roomId} roomName={roomName} gifsEnabled={gifsEnabled} />
      </ListsProvider>
    </ChatProvider>
  );
}

function RoomPhases({
  slug,
  roomId,
  roomName,
  me,
  partner,
  aside,
}: Pick<Props, "slug" | "roomId" | "roomName" | "me" | "partner" | "aside">) {
  const myName = me.name;
  const myHue = me.hue;
  const partnerName = partner?.name ?? null;
  const [phase, setPhase] = useState<Phase>({ kind: "precall" });
  const chat = useMaybeChat();
  const inCall = phase.kind === "call";
  usePresenceAlerts({ chat, inCall, roomName, partnerName, url: `/r/${slug}` });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [rejoining, setRejoining] = useState(false);
  const rejoins = useRef<number[]>([]);
  const router = useRouter();
  const phone = usePhone();
  const sheet = usePhoneSheet();
  // Sheets belong to this room page only.
  useEffect(() => () => setPhoneSheet(null), []);

  async function join(prefs: DevicePrefs) {
    setJoining(true);
    setJoinError(null);
    try {
      const connection = await fetchToken(slug);
      setPhase({ kind: "call", connection, prefs });
      setPhoneSheet(null);
    } catch (err) {
      setJoinError((err as Error).message);
    } finally {
      setJoining(false);
    }
  }

  /** Clean rejoin after a broken reconnect: fresh token, fresh Room. Up to 3 tries a minute. */
  async function rejoin(prefs: DevicePrefs) {
    const now = Date.now();
    rejoins.current = rejoins.current.filter((t) => now - t < 60_000);
    if (rejoins.current.length >= 3) {
      setPhase({
        kind: "ended",
        reason: { kind: "failed", message: "The connection keeps dropping. Check your network and rejoin." },
      });
      return;
    }
    rejoins.current.push(now);
    setRejoining(true);
    try {
      const connection = await fetchToken(slug);
      setPhase({ kind: "call", connection, prefs });
    } catch {
      setPhase({ kind: "ended", reason: { kind: "failed", message: "Couldn't reconnect to the call." } });
    } finally {
      setRejoining(false);
    }
  }

  // Someone we don't know yet showed up on the room's channel: the invite was just accepted. The room
  // details here were rendered before that, so fetch them again. Accepting an invite also replaces the
  // room's media key, so a call that started before they arrived must rejoin with a fresh token, or
  // the two of you would encrypt with different keys and see nothing of each other.
  const newArrival = !partner && !!chat?.partnerPresence.online;
  const onArrival = useEffectEvent(() => {
    router.refresh();
    if (phase.kind === "call") void rejoin(phase.prefs);
  });
  useEffect(() => {
    if (!newArrival) return;
    const t = setTimeout(onArrival, 0);
    return () => clearTimeout(t);
  }, [newArrival]);

  if (phase.kind === "call") {
    const prefs = phase.prefs;
    return (
      <MeetingRoom
        roomId={roomId}
        connection={phase.connection}
        prefs={prefs}
        roomName={roomName}
        partnerName={partnerName}
        // On a phone, leaving just goes back to the chat; problems still get the full explanation.
        onLeave={(reason) => setPhase(phone && reason.kind === "left" ? { kind: "precall" } : { kind: "ended", reason })}
        onRejoinNeeded={() => void rejoin(prefs)}
        rejoining={rejoining}
      />
    );
  }

  if (phase.kind === "ended") {
    const back = () => setPhase({ kind: "precall" });
    if (phone) {
      return (
        <PhoneSheet open title="Call ended" onClose={back}>
          <CallEnded
            reason={phase.reason}
            onRejoin={() => {
              back();
              setPhoneSheet("call");
            }}
          />
        </PhoneSheet>
      );
    }
    return <CallEnded reason={phase.reason} onRejoin={back} />;
  }

  // Before hydration we don't know the screen size: render nothing rather than start a camera.
  if (phone === null) return <div className="flex-1" />;

  if (phone) {
    // The chat is the room screen; the call setup and room details are sheets over it. The camera
    // preview only exists while the call sheet is open.
    return (
      <>
        <PhoneSheet
          open={sheet === "call"}
          full
          title={partnerName ? `Call ${partnerName}` : "Video call"}
          onClose={() => setPhoneSheet(null)}
          testId="call-sheet"
        >
          <PreCallStudio
            variant="sheet"
            roomName={roomName}
            myName={myName}
            myHue={myHue}
            partnerName={partnerName}
            joining={joining}
            joinError={joinError}
            onJoin={(prefs) => void join(prefs)}
            presence={chat?.partnerPresence}
            onKnock={chat?.knock}
          />
        </PhoneSheet>
        <PhoneSheet open={sheet === "info"} title={roomName} onClose={() => setPhoneSheet(null)} testId="room-info-sheet">
          <div className="px-4 pb-6">{aside}</div>
        </PhoneSheet>
      </>
    );
  }

  return (
    <PreCallStudio
      roomName={roomName}
      myName={myName}
      myHue={myHue}
      partnerName={partnerName}
      joining={joining}
      joinError={joinError}
      onJoin={(prefs) => void join(prefs)}
      aside={aside}
      presence={chat?.partnerPresence}
      onKnock={chat?.knock}
    />
  );
}

function CallEnded({ reason, onRejoin }: { reason: LeaveReason; onRejoin: () => void }) {
  const copy = {
    left: { emoji: "👋", title: "You left the call", body: "Your camera and microphone are off." },
    duplicate: {
      emoji: "🪟",
      title: "You joined from another tab",
      body: "This tab was disconnected so you don't echo yourself.",
    },
    removed: { emoji: "🚪", title: "The call ended", body: "The room was closed or you no longer have access." },
    failed: { emoji: "📡", title: "Disconnected", body: reason.kind === "failed" ? reason.message : "" },
  }[reason.kind];

  return (
    <div
      className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center"
      data-testid="call-ended"
    >
      <div className="text-5xl" aria-hidden>
        {copy.emoji}
      </div>
      <h1 className="text-3xl font-bold" role="status">
        {copy.title}
      </h1>
      <p className="text-muted-foreground">{copy.body}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {reason.kind !== "removed" && (
          <Button size="lg" variant="brand" onClick={onRejoin}>
            <RotateCcw /> Rejoin
          </Button>
        )}
        <Button size="lg" variant="outline" asChild>
          <Link href="/home">
            <DoorOpen /> Back to rooms
          </Link>
        </Button>
      </div>
    </div>
  );
}
