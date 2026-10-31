"use client";

import Link from "next/link";
import { useState } from "react";
import { DoorOpen, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { callTokenResponseSchema, type CallTokenResponse } from "@/shared/call";
import type { DevicePrefs } from "../device-prefs";
import { MeetingRoom, type LeaveReason } from "./meeting-room";
import { PreCallStudio } from "./pre-call-studio";

type Phase =
  | { kind: "precall" }
  | { kind: "call"; connection: CallTokenResponse; prefs: DevicePrefs }
  | { kind: "ended"; reason: LeaveReason };

type Props = {
  slug: string;
  roomName: string;
  myName: string;
  myHue: number;
  partnerName: string | null;
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

export function RoomExperience({ slug, roomName, myName, myHue, partnerName, aside }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "precall" });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  async function join(prefs: DevicePrefs) {
    setJoining(true);
    setJoinError(null);
    try {
      const connection = await fetchToken(slug);
      setPhase({ kind: "call", connection, prefs });
    } catch (err) {
      setJoinError((err as Error).message);
    } finally {
      setJoining(false);
    }
  }

  if (phase.kind === "call") {
    return (
      <MeetingRoom
        connection={phase.connection}
        prefs={phase.prefs}
        roomName={roomName}
        partnerName={partnerName}
        onLeave={(reason) => setPhase({ kind: "ended", reason })}
      />
    );
  }

  if (phase.kind === "ended") {
    return <CallEnded reason={phase.reason} onRejoin={() => setPhase({ kind: "precall" })} />;
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
