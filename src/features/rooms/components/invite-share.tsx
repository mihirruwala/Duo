"use client";

import { useState } from "react";
import { Check, Copy, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildInviteUrl } from "@/shared/invite";

/** Shows a freshly issued invite link. The plaintext code exists only in this moment. */
export function InviteShare({ code, expiresAt }: { code: string; expiresAt: string }) {
  // Rendered only on the client after a user action, so window is available.
  const url = buildInviteUrl(window.location.origin, code);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it manually.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-ink-1 p-2 pl-3">
        <input
          readOnly
          value={url}
          aria-label="Invite link"
          data-testid="invite-link"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm text-cream outline-none"
        />
        <Button size="sm" variant={copied ? "secondary" : "default"} onClick={copy} disabled={!url}>
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden />
        <span>
          Works once, for one person, until{" "}
          {new Date(expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}. After they join, the room is
          locked to the two of you.
        </span>
      </p>
    </div>
  );
}
