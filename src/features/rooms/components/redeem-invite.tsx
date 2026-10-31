"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { DoorOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/shared/errors";
import { parseInviteInput } from "@/shared/invite";
import { JoinCodeForm } from "./join-code-form";

const PENDING_KEY = "duo.pendingInvite";

function readPending(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}
function writePending(code: string | null) {
  try {
    if (code) sessionStorage.setItem(PENDING_KEY, code);
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage unavailable (private mode). The user can re-open the link after signing in.
  }
}

// The fragment is read once per page load and cached, so the snapshot stays stable
// after we strip the code from the address bar.
let captured: string | null | undefined;
function captureInvite(): string | null {
  if (captured === undefined) {
    captured = parseInviteInput(window.location.hash.slice(1)) ?? parseInviteInput(readPending() ?? "");
  }
  return captured;
}
const noopSubscribe = () => () => {};

/**
 * Reads the invite code from the URL fragment (never sent to the server). Redemption
 * needs an explicit click: link-preview bots and prefetchers must not burn the invite.
 */
export function RedeemInvite({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const code = useSyncExternalStore(noopSubscribe, captureInvite, () => undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // Survive the sign-in round trip, then remove the secret from the address bar and history.
    if (code) writePending(code);
    if (window.location.hash) history.replaceState(null, "", window.location.pathname);
  }, [code]);

  if (code === undefined) {
    return <div className="h-40 animate-pulse rounded-2xl bg-ink-3/50" aria-busy />;
  }

  if (code === null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold">Join a room</h1>
        <p className="text-muted-foreground">Paste the invite link or code your person sent you.</p>
        <JoinCodeForm />
      </div>
    );
  }

  function join() {
    startTransition(async () => {
      const { data, error } = await getBrowserClient().rpc("redeem_invite", { p_code: code! });
      const row = data?.[0];
      if (error || !row) {
        setError(friendlyError(error));
        writePending(null);
        return;
      }
      writePending(null);
      router.replace(`/r/${row.slug}`);
    });
  }

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <span className="grid size-16 place-items-center rounded-3xl bg-duo-gradient text-ink-0" aria-hidden>
        <DoorOpen className="size-8" />
      </span>
      <div>
        <h1 className="text-3xl font-bold">You&apos;re invited</h1>
        <p className="mt-2 text-muted-foreground">Someone saved you a seat in their private DUO room.</p>
      </div>

      {error && (
        <p
          role="alert"
          className="w-full rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {signedIn ? (
        <Button size="lg" variant="brand" className="w-full" onClick={join} disabled={pending || Boolean(error)}>
          {pending && <Loader2 className="animate-spin" />} Join room
        </Button>
      ) : (
        <div className="flex w-full flex-col gap-2">
          <Button asChild size="lg" variant="brand">
            <Link href="/sign-up?next=/join">Create an account to join</Link>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link href="/sign-in?next=/join">I already have an account</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
