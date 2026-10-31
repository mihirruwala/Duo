"use client";

import { useState, useTransition } from "react";
import { Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/shared/errors";
import { toast } from "sonner";
import { InviteShare } from "./invite-share";

/** Host-only: issue a fresh single-use invite (the previous one stops working). */
export function NewInviteButton({ roomId, size = "sm" }: { roomId: string; size?: "sm" | "default" }) {
  const [pending, startTransition] = useTransition();
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null);

  return (
    <>
      <Button
        variant="outline"
        size={size}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const { data, error } = await getBrowserClient().rpc("rotate_invite", { p_room_id: roomId });
            const row = data?.[0];
            if (error || !row) {
              toast.error(friendlyError(error));
              return;
            }
            setInvite({ code: row.invite_code, expiresAt: row.invite_expires_at });
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <Link2 />} New invite link
      </Button>
      <Dialog open={invite !== null} onOpenChange={(o) => !o && setInvite(null)}>
        <DialogContent className="rounded-[1.75rem] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">Fresh invite link</DialogTitle>
            <DialogDescription>Any earlier link for this room no longer works.</DialogDescription>
          </DialogHeader>
          {invite && <InviteShare code={invite.code} expiresAt={invite.expiresAt} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
