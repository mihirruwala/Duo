"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseInviteInput } from "@/shared/invite";
import { cn } from "@/lib/utils";

/** "Join with invite code": accepts a code or a pasted invite link. */
export function JoinCodeForm({ className }: { className?: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className={cn("flex flex-col gap-1.5", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const code = parseInviteInput(value);
        if (!code) {
          setError("That doesn't look like a DUO invite code or link.");
          return;
        }
        setError(null);
        router.push(`/join#${code}`);
      }}
    >
      <div className="flex gap-2">
        <label htmlFor="invite-code" className="sr-only">
          Invite code or link
        </label>
        <Input
          id="invite-code"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste invite code or link"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "invite-code-error" : undefined}
          className="h-12 min-w-0 sm:w-64"
        />
        <Button type="submit" size="lg" variant="outline" disabled={!value.trim()}>
          <Ticket /> Join
        </Button>
      </div>
      {error && (
        <p id="invite-code-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
