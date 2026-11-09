"use client";

import { useState } from "react";
import { BellRing, DoorOpen, PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PartnerPresence } from "@/shared/presence";

/** "Gabe is in the call · Join now" / "Gabe is here" / "Gabe is away · Knock". */
export function PresenceBanner({
  partnerName,
  presence,
  onJoin,
  onKnock,
  joining,
}: {
  partnerName: string;
  presence: PartnerPresence;
  onJoin: () => void;
  onKnock: () => boolean;
  joining: boolean;
}) {
  const [knocked, setKnocked] = useState(false);
  const tone = presence.inCall ? "call" : presence.where === "room" ? "here" : presence.online ? "online" : "away";
  const text = {
    call: `${partnerName} is in the call`,
    here: `${partnerName} is here in the room`,
    online: `${partnerName} is on DUO`,
    away: `${partnerName} isn't here right now`,
  }[tone];

  return (
    <div
      role="status"
      data-testid="presence-banner"
      data-tone={tone}
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm",
        tone === "call"
          ? "border-coral/40 bg-coral/12"
          : tone === "here"
            ? "border-mint/30 bg-mint/10"
            : "border-border bg-ink-1/60",
      )}
    >
      <span className="relative flex size-2.5">
        {(tone === "call" || tone === "here") && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-mint opacity-60" />
        )}
        <span
          className={cn(
            "relative inline-flex size-2.5 rounded-full",
            tone === "away" ? "bg-ink-4" : tone === "call" ? "bg-coral" : "bg-mint",
          )}
        />
      </span>
      <span className="min-w-0 flex-1 font-semibold max-sm:basis-[calc(100%-2rem)]">{text}</span>
      {tone === "call" ? (
        <Button size="sm" variant="brand" onClick={onJoin} disabled={joining} data-testid="join-partner">
          <PhoneCall /> Join now
        </Button>
      ) : tone === "here" ? (
        <span className="flex items-center gap-1.5 text-muted-foreground max-sm:basis-full max-sm:pl-5.5 max-sm:text-[13px]">
          <DoorOpen className="size-4 max-sm:hidden" /> Join the call and they&apos;ll hear a chime
        </span>
      ) : (
        <Button
          size="sm"
          variant="outline"
          data-testid="knock"
          disabled={knocked}
          onClick={() => {
            if (onKnock()) {
              setKnocked(true);
              toast.success(`Knocked. ${partnerName} will hear it if DUO is open.`);
              setTimeout(() => setKnocked(false), 10_000);
            }
          }}
        >
          <BellRing /> {knocked ? "Knocked" : "Knock"}
        </Button>
      )}
    </div>
  );
}
