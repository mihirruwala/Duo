"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { KeyRound, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/shared/errors";

/** Same rule as sign-up. */
export const newPasswordSchema = z.string().min(10, "Use at least 10 characters.").max(72, "That password is too long.");

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  );
}

/**
 * Asks for a reset link. The answer never says whether an account exists for that email, so the
 * form can't be used to find out who has a DUO account.
 */
export function ForgotPasswordForm({ linkExpired }: { linkExpired?: boolean }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 text-center" role="status" data-testid="reset-sent">
        <MailCheck className="size-10 text-mint" aria-hidden />
        <h2 className="text-2xl font-bold">Check your inbox</h2>
        <p className="text-muted-foreground">
          If there&apos;s a DUO account for <span className="font-semibold text-foreground">{email}</span>, we&apos;ve sent it a
          link to choose a new password. It works on any device and expires in an hour.
        </p>
        <Link href="/sign-in" className="text-sm font-semibold underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = z.email().safeParse(email.trim());
        if (!parsed.success) return setError("Enter a valid email address.");
        setError(null);
        startTransition(async () => {
          const { error } = await getBrowserClient().auth.resetPasswordForEmail(parsed.data, {
            redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
          });
          // Rate limits are worth telling people about; "no such user" is not (and Supabase doesn't say).
          if (error && error.status === 429) return setError("Too many reset emails. Wait a few minutes and try again.");
          if (error) return setError(friendlyError(error));
          setSent(true);
        });
      }}
    >
      {linkExpired && <Alert>That reset link has expired or was already used. Ask for a new one below.</Alert>}
      <div className="flex flex-col gap-2">
        <Label htmlFor="reset-email">Email</Label>
        <Input
          id="reset-email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </div>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" size="lg" variant="brand" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Send reset link
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/sign-in" className="font-semibold text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

/** Two matching password fields (new + repeat), shared by reset and change. */
function NewPasswordFields({ idPrefix }: { idPrefix: string }) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-new`}>New password</Label>
        <Input
          id={`${idPrefix}-new`}
          name="new"
          type="password"
          autoComplete="new-password"
          placeholder="At least 10 characters"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-repeat`}>Repeat it</Label>
        <Input id={`${idPrefix}-repeat`} name="repeat" type="password" autoComplete="new-password" />
      </div>
    </>
  );
}

function readNewPassword(form: FormData): { password: string } | { error: string } {
  const password = String(form.get("new") ?? "");
  const parsed = newPasswordSchema.safeParse(password);
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  if (password !== String(form.get("repeat") ?? "")) return { error: "The two passwords don't match." };
  return { password };
}

/** After following the emailed link (which signed them in for this purpose): choose the new password. */
export function ResetPasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const r = readNewPassword(new FormData(e.currentTarget));
        if ("error" in r) return setError(r.error);
        setError(null);
        startTransition(async () => {
          const { error } = await getBrowserClient().auth.updateUser({ password: r.password });
          if (error) return setError(friendlyError(error));
          toast.success("Password changed. You're signed in.");
          router.replace("/home");
          router.refresh();
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        For <span className="font-semibold text-foreground">{email}</span>
      </p>
      <NewPasswordFields idPrefix="reset" />
      {error && <Alert>{error}</Alert>}
      <Button type="submit" size="lg" variant="brand" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Save new password
      </Button>
    </form>
  );
}

/** Settings: change the password while signed in (asks for the current one first). */
export function ChangePasswordForm({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <KeyRound /> Change password
      </Button>
    );
  }
  return (
    <form
      noValidate
      className="flex max-w-sm flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const current = String(form.get("current") ?? "");
        if (!current) return setError("Enter your current password.");
        const r = readNewPassword(form);
        if ("error" in r) return setError(r.error);
        setError(null);
        const target = e.currentTarget;
        startTransition(async () => {
          const supabase = getBrowserClient();
          const check = await supabase.auth.signInWithPassword({ email, password: current });
          if (check.error) return setError("Your current password isn't right.");
          const { error } = await supabase.auth.updateUser({ password: r.password });
          if (error) return setError(friendlyError(error));
          target.reset();
          setOpen(false);
          toast.success("Password changed.");
        });
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="change-current">Current password</Label>
        <Input id="change-current" name="current" type="password" autoComplete="current-password" />
      </div>
      <NewPasswordFields idPrefix="change" />
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
