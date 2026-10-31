"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { useMaybeChat } from "@/features/chat/chat-provider";
import { alertPerson } from "./alerts";

/**
 * Room page: tell the channel whether I'm in the call, and alert me (chime, notification, toast)
 * when my person joins the call, arrives in the room, or knocks.
 */
export function usePresenceAlerts({
  chat,
  inCall,
  roomName,
  partnerName,
  url,
}: {
  chat: ReturnType<typeof useMaybeChat>;
  inCall: boolean;
  roomName: string;
  partnerName: string | null;
  url: string;
}) {
  const setInCall = chat?.setInCall;
  useEffect(() => {
    setInCall?.(inCall);
  }, [setInCall, inCall]);

  const presence = chat?.partnerPresence;
  const prev = useRef(presence);
  const name = partnerName ?? "Your person";
  useEffect(() => {
    const before = prev.current;
    prev.current = presence;
    if (!presence || !before || inCall) return;
    if (presence.inCall && !before.inCall) {
      if (alertPerson(`call:${url}`, { title: `${name} joined the call`, body: `In “${roomName}”. Tap to join.`, url })) {
        toast(`${name} joined the call`, { description: "They're waiting for you." });
      }
    } else if (presence.where === "room" && before.where !== "room") {
      if (alertPerson(`here:${url}`, { title: `${name} is in the room`, body: `“${roomName}”`, url })) {
        toast(`${name} is here`, { description: "Join the call to say hi." });
      }
    }
  }, [presence, inCall, name, roomName, url]);

  const onKnock = chat?.onKnock;
  useEffect(() => {
    if (!onKnock) return;
    return onKnock(() => {
      if (alertPerson(`knock:${url}`, { title: `${name} is knocking`, body: `“${roomName}”: they'd like to talk.`, url })) {
        toast(`${name} is knocking 👋`, { description: inCall ? "They want your attention." : "Join the call to answer." });
      }
    });
  }, [onKnock, name, roomName, url, inCall]);
}
