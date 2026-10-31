"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, use, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Bell, BellOff, PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getBrowserClient } from "@/lib/supabase/client";
import { KNOCK_EVENT, OFFLINE, partnerPresenceFrom, type PartnerPresence } from "@/shared/presence";
import { alertPerson, getAlertPrefs, notificationPermission, requestNotificationPermission, setAlertPrefs } from "../alerts";

type HomeRoom = { id: string; slug: string; name: string; partnerName: string | null };

const PresenceContext = createContext<Record<string, PartnerPresence>>({});

/**
 * Home: joins each room's private channel to show where your person is, and alerts you when they
 * arrive, start a call or knock. (On a room page the chat provider owns that channel instead.)
 */
export function HomePresence({ myId, rooms, children }: { myId: string; rooms: HomeRoom[]; children: React.ReactNode }) {
  const [presence, setPresence] = useState<Record<string, PartnerPresence>>({});
  const roomsKey = rooms.map((r) => r.id).join(",");
  const roomsRef = useRef(rooms);
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    roomsRef.current = rooms;
    routerRef.current = router;
  });

  useEffect(() => {
    const client = getBrowserClient();
    const channels: RealtimeChannel[] = [];
    let alive = true;
    const prev: Record<string, PartnerPresence> = {};
    void (async () => {
      await client.realtime.setAuth();
      for (const room of roomsRef.current.filter((r) => r.partnerName).slice(0, 20)) {
        if (!alive) return;
        const url = `/r/${room.slug}`;
        const name = room.partnerName ?? "Your person";
        const ch = client.channel(`room:${room.id}`, {
          config: { private: true, broadcast: { self: false }, presence: { key: myId } },
        });
        ch.on("presence", { event: "sync" }, () => {
          const next = partnerPresenceFrom(ch.presenceState() as Record<string, unknown[]>, myId);
          const before = prev[room.id];
          prev[room.id] = next;
          setPresence((p) => ({ ...p, [room.id]: next }));
          if (!before) return; // initial state isn't news
          if (next.inCall && !before.inCall) {
            if (alertPerson(`call:${url}`, { title: `${name} started a call`, body: `In “${room.name}”. Tap to join.`, url })) {
              toast(`${name} is in a call in “${room.name}”`, {
                action: { label: "Join", onClick: () => routerRef.current.push(url) },
              });
            }
          } else if (next.where === "room" && before.where !== "room") {
            if (alertPerson(`here:${url}`, { title: `${name} is in “${room.name}”`, body: "They're waiting for you.", url })) {
              toast(`${name} is in “${room.name}”`, { action: { label: "Go", onClick: () => routerRef.current.push(url) } });
            }
          }
        })
          .on("broadcast", { event: KNOCK_EVENT }, ({ payload }) => {
            if ((payload as { userId?: string })?.userId === myId) return;
            if (
              alertPerson(`knock:${url}`, { title: `${name} is knocking`, body: `“${room.name}”: they'd like to talk.`, url })
            ) {
              toast(`${name} is knocking 👋`, {
                description: `In “${room.name}”`,
                action: { label: "Go", onClick: () => routerRef.current.push(url) },
              });
            }
          })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") void ch.track({ where: "home", inCall: false, at: new Date().toISOString() });
          });
        channels.push(ch);
      }
    })();
    return () => {
      alive = false;
      for (const ch of channels) void client.removeChannel(ch);
    };
  }, [myId, roomsKey]);

  return <PresenceContext value={presence}>{children}</PresenceContext>;
}

/** Live status line for a room card. */
export function RoomPresenceStatus({ roomId, slug, partnerName }: { roomId: string; slug: string; partnerName: string }) {
  const p = use(PresenceContext)[roomId] ?? OFFLINE;
  if (p.inCall) {
    return (
      <span className="flex items-center gap-2 text-sm font-semibold text-coral" data-testid="room-presence" data-state="call">
        <span className="size-2 animate-pulse rounded-full bg-coral" aria-hidden /> {partnerName} is in the call
        <Button asChild size="xs" variant="brand" className="ml-auto">
          <Link href={`/r/${slug}`}>
            <PhoneCall /> Join
          </Link>
        </Button>
      </span>
    );
  }
  const [dot, text, state] =
    p.where === "room"
      ? ["bg-mint", `${partnerName} is in the room`, "room"]
      : p.online
        ? ["bg-mint/60", `${partnerName} is on DUO`, "online"]
        : ["bg-violet", `With ${partnerName}`, "away"];
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="room-presence" data-state={state}>
      <span className={`size-2 rounded-full ${dot}`} aria-hidden /> {text}
    </span>
  );
}

/** Notifications opt-in + sound toggle. Permission is only requested from this click. */
export function AlertsControl() {
  const [perm, setPerm] = useState<ReturnType<typeof notificationPermission>>("default");
  const [sound, setSound] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => {
      setPerm(notificationPermission());
      setSound(getAlertPrefs().sound);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {perm === "default" && (
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            const r = await requestNotificationPermission();
            setPerm(r);
            if (r === "granted") toast.success("You'll get a notification when your person arrives or knocks.");
          }}
        >
          <Bell /> Notify me when they arrive
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={sound}
        onClick={() => {
          const next = !sound;
          setSound(next);
          setAlertPrefs({ ...getAlertPrefs(), sound: next });
        }}
      >
        {sound ? <Bell /> : <BellOff />} {sound ? "Chime on" : "Chime off"}
      </Button>
    </div>
  );
}
