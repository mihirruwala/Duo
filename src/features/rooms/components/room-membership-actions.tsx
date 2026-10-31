"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/shared/errors";
import type { MemberRole } from "@/shared/database";

/** Host deletes the room (and all its history); a guest removes themselves from the allowlist. */
export function RoomMembershipActions({ roomId, slug, role }: { roomId: string; slug: string; role: MemberRole }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const isHost = role === "host";

  function confirm() {
    startTransition(async () => {
      const supabase = getBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      let error: { message?: string; code?: string } | null = null;
      if (isHost) {
        // Server route: removes the room's files from storage too, then the room.
        const res = await fetch(`/api/rooms/${encodeURIComponent(slug)}/delete`, { method: "POST" });
        if (!res.ok)
          error = ((await res.json().catch(() => null)) as { message?: string } | null) ?? { message: "delete_failed" };
      } else {
        ({ error } = await supabase
          .from("room_members")
          .delete()
          .eq("room_id", roomId)
          .eq("user_id", auth.user?.id ?? ""));
      }
      if (error) {
        toast.error(friendlyError(error));
        return;
      }
      setOpen(false);
      router.replace("/home");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="w-fit text-muted-foreground hover:text-destructive">
          {isHost ? "Delete room" : "Leave room"}
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-[1.75rem] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isHost ? "Delete this room?" : "Leave this room?"}</DialogTitle>
          <DialogDescription>
            {isHost
              ? "Messages, files and Moments in it are deleted for both of you. This can't be undone."
              : "You'll lose access to this room and its history. The host can invite you again."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {isHost ? "Delete room" : "Leave room"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
