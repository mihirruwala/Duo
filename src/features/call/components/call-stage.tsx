"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { cn } from "@/lib/utils";
import { ParticipantTile } from "./participant-tile";

/** Who has the big spot. `null` = automatic (side by side, or the shared content when there is some). */
export type CallPin = "them" | "me" | null;

const PIN_KEY = "duo.callPin.v1";

/** The pin is a personal preference, so it's remembered on this device for the next call. */
export function useCallPin() {
  const [pin, setPinState] = useState<CallPin>(null);
  useEffect(() => {
    let saved: CallPin = null;
    try {
      const v = localStorage.getItem(PIN_KEY);
      if (v === "them" || v === "me") saved = v;
    } catch {
      // Storage unavailable: start unpinned.
    }
    if (saved) {
      const t = setTimeout(() => setPinState(saved), 0);
      return () => clearTimeout(t);
    }
  }, []);
  const setPin = useCallback((next: CallPin) => {
    setPinState(next);
    try {
      if (next) localStorage.setItem(PIN_KEY, next);
      else localStorage.removeItem(PIN_KEY);
    } catch {
      // Not remembered; still applies to this call.
    }
  }, []);
  return [pin, setPin] as const;
}

type Slot = "a" | "b" | "main" | "t1" | "t2" | "float";

export type StageContent = {
  /** Changing the key remounts the content (e.g. a screen share replaced by Watch Together). */
  key: string;
  render: (opts: { compact: boolean; style: React.CSSProperties; onActivate: (e?: React.MouseEvent) => void }) => React.ReactNode;
};

/**
 * Lays out the call: the two cameras, plus shared content (a screen share or Watch Together).
 *  - nothing pinned, no content → side by side
 *  - a person pinned, no content → that person fills the stage, the other floats in a corner
 *  - content → the content (or the pinned person) is big, the rest sit in a strip
 * Clicking a small tile swaps it into the big spot. Every child keeps its position in the tree,
 * so videos and an embedded player never reload when the layout changes.
 */
export function CallStage({
  localCam,
  remoteCam,
  waiting,
  content,
  pin,
  onPin,
}: {
  localCam: TrackReferenceOrPlaceholder | undefined;
  remoteCam: TrackReferenceOrPlaceholder | undefined;
  /** Shown in the other person's place until they join. */
  waiting: React.ReactNode;
  content: StageContent | null;
  pin: CallPin;
  onPin: (pin: CallPin) => void;
}) {
  // A pin on someone who isn't here (yet) falls back to automatic, without forgetting the choice.
  const effective: CallPin = pin === "them" && !remoteCam ? null : pin === "me" && !localCam ? null : pin;
  const main: "content" | "them" | "me" | null = effective ?? (content ? "content" : null);
  const layout = content ? "side" : main ? "solo" : "duo";

  const slots: Record<"content" | "them" | "me", Slot> = (() => {
    if (layout === "duo") return { content: "main", me: "a", them: "b" };
    if (layout === "solo")
      return main === "them" ? { content: "main", them: "main", me: "float" } : { content: "main", me: "main", them: "float" };
    if (main === "content") return { content: "main", them: "t1", me: "t2" };
    if (main === "them") return { them: "main", content: "t1", me: "t2" };
    return { me: "main", content: "t1", them: "t2" };
  })();

  const area = (s: Slot): React.CSSProperties => (s === "float" ? {} : { gridArea: s });
  const tileClass = (s: Slot) =>
    cn(
      s === "a" || s === "b"
        ? "aspect-video max-h-full w-full self-center"
        : s === "main"
          ? "h-full min-h-0 w-full"
          : s === "float"
            ? "absolute right-3 bottom-3 z-10 aspect-video w-32 shadow-2xl sm:w-52"
            : "aspect-video w-full",
    );
  const small = (s: Slot) => s === "t1" || s === "t2" || s === "float";
  const toggle = (who: "them" | "me") => onPin(effective === who ? null : who);
  const activate = (who: "content" | "them" | "me", e?: React.MouseEvent) => {
    // The layout moves under the pointer on a swap, so the second click of a double-click lands on
    // whatever slid into place. Only the first click counts.
    if (e && e.detail > 1) return;
    onPin(who === "content" ? null : who);
  };

  return (
    <div className="duo-stage" data-layout={layout} data-main={main ?? "none"} data-testid="call-stage">
      {content && (
        <Fragment key={content.key}>
          {content.render({
            compact: slots.content !== "main",
            style: area(slots.content),
            onActivate: (e) => activate("content", e),
          })}
        </Fragment>
      )}
      {remoteCam ? (
        <ParticipantTile
          key="them"
          trackRef={remoteCam}
          slot={slots.them}
          style={area(slots.them)}
          variant={small(slots.them) ? "thumb" : "stage"}
          className={tileClass(slots.them)}
          pinned={effective === "them"}
          onTogglePin={() => toggle("them")}
          onActivate={small(slots.them) ? (e) => activate("them", e) : undefined}
        />
      ) : (
        !small(slots.them) && (
          <div key="waiting" style={area(slots.them)} className="min-h-0 self-center">
            {waiting}
          </div>
        )
      )}
      {localCam && (
        <ParticipantTile
          key="me"
          trackRef={localCam}
          slot={slots.me}
          style={area(slots.me)}
          variant={small(slots.me) ? "thumb" : "stage"}
          className={tileClass(slots.me)}
          pinned={effective === "me"}
          onTogglePin={() => toggle("me")}
          onActivate={small(slots.me) ? (e) => activate("me", e) : undefined}
        />
      )}
    </div>
  );
}
