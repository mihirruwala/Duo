"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { getBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/shared/errors";

/** Room setting: end-to-end encrypted calls (host can change it; applies from the next join). */
export function E2eeSetting({ roomId, enabled, isHost }: { roomId: string; enabled: boolean; isHost: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();
  const Icon = on ? ShieldCheck : ShieldOff;
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-ink-1/60 p-4">
      <label className="flex items-center justify-between gap-3 text-sm font-semibold">
        <span className="flex items-center gap-2">
          <Icon className={on ? "size-4 text-mint" : "size-4 text-muted-foreground"} aria-hidden /> End-to-end encrypted calls
        </span>
        {isHost ? (
          <Switch
            checked={on}
            disabled={pending}
            aria-label="End-to-end encrypted calls"
            onCheckedChange={(next) =>
              startTransition(async () => {
                const { error } = await getBrowserClient().from("rooms").update({ e2ee_enabled: next }).eq("id", roomId);
                if (error) return void toast.error(friendlyError(error));
                setOn(next);
                router.refresh();
              })
            }
          />
        ) : (
          <span className={on ? "text-mint" : "text-muted-foreground"}>{on ? "On" : "Off"}</span>
        )}
      </label>
      <p className="text-xs text-muted-foreground">
        {on
          ? "Audio, video and screen shares are encrypted on your devices; the media server only relays ciphertext."
          : "Calls are encrypted in transit, but the media server can see them. Turn this on unless a device has trouble."}
      </p>
    </div>
  );
}
