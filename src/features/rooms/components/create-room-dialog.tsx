"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/shared/errors";
import { InviteShare } from "./invite-share";

const nameSchema = z.string().trim().min(1, "Give your room a name.").max(60, "Keep it under 60 characters.");

type Created = { slug: string; inviteCode: string; expiresAt: string };

export function CreateRoomDialog({ trigger }: { trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setName("");
    setError(null);
    setCreated(null);
  }

  function submit() {
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setError(null);
    startTransition(async () => {
      const { data, error } = await getBrowserClient().rpc("create_room", { p_name: parsed.data });
      const row = data?.[0];
      if (error || !row) return setError(friendlyError(error));
      setCreated({ slug: row.slug, inviteCode: row.invite_code, expiresAt: row.invite_expires_at });
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="brand" size="lg">
            <Plus /> New room
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="rounded-[1.75rem] sm:max-w-md">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl">Your room is ready ✨</DialogTitle>
              <DialogDescription>
                Send this link to your person. It&apos;s shown only now, so copy it before closing.
              </DialogDescription>
            </DialogHeader>
            <InviteShare code={created.inviteCode} expiresAt={created.expiresAt} />
            <Button asChild size="lg" className="mt-2">
              <Link href={`/r/${created.slug}`}>
                Enter room <ArrowRight />
              </Link>
            </Button>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex flex-col gap-5"
          >
            <DialogHeader>
              <DialogTitle className="text-2xl">Start a private room</DialogTitle>
              <DialogDescription>Only you and the one person you invite can ever get in.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="room-name">Room name</Label>
              <Input
                id="room-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sunday catch-up"
                maxLength={60}
                autoFocus
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "room-name-error" : undefined}
              />
              {error && (
                <p id="room-name-error" role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <Button type="submit" size="lg" variant="brand" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Create room
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
