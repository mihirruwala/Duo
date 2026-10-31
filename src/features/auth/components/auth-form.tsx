"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cloneElement, useState, useTransition } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/shared/errors";
import { safeNextPath } from "@/shared/invite";

const signInSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

const signUpSchema = z.object({
  displayName: z.string().trim().min(1, "What should your person call you?").max(40, "Keep it under 40 characters."),
  email: z.email("Enter a valid email address."),
  password: z.string().min(10, "Use at least 10 characters.").max(72, "That password is too long."),
});

type Mode = "sign-in" | "sign-up";
type FieldErrors = Partial<Record<"displayName" | "email" | "password", string>>;

export function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const target = safeNextPath(next);

  // onSubmit (not <form action>): React resets uncontrolled fields after an action, which would
  // wipe what the person typed whenever validation fails.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormError(null);
    const raw = Object.fromEntries(form.entries());
    const schema = mode === "sign-up" ? signUpSchema : signInSchema;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors;
        fieldErrors[key] ??= issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    startTransition(async () => {
      const supabase = getBrowserClient();
      if (mode === "sign-up") {
        const data = parsed.data as z.infer<typeof signUpSchema>;
        const { data: result, error } = await supabase.auth.signUp({
          email: data.email,
          password: data.password,
          options: {
            data: { display_name: data.displayName },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(target)}`,
          },
        });
        if (error) return setFormError(friendlyError(error));
        if (!result.session) return setCheckEmail(true);
      } else {
        const data = parsed.data as z.infer<typeof signInSchema>;
        const { error } = await supabase.auth.signInWithPassword(data);
        if (error) return setFormError(friendlyError(error));
      }
      router.replace(target);
      router.refresh();
    });
  }

  if (checkEmail) {
    return (
      <div className="flex flex-col items-center gap-3 text-center" role="status">
        <MailCheck className="size-10 text-mint" aria-hidden />
        <h2 className="text-2xl font-bold">Check your inbox</h2>
        <p className="text-muted-foreground">We sent you a confirmation link. Open it on this device to finish signing up.</p>
      </div>
    );
  }

  const otherHref = `${mode === "sign-in" ? "/sign-up" : "/sign-in"}${next ? `?next=${encodeURIComponent(target)}` : ""}`;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {mode === "sign-up" && (
        <Field id="displayName" label="Your name" error={errors.displayName}>
          <Input id="displayName" name="displayName" autoComplete="nickname" maxLength={40} placeholder="Sam" />
        </Field>
      )}
      <Field id="email" label="Email" error={errors.email}>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" />
      </Field>
      <Field id="password" label="Password" error={errors.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          placeholder={mode === "sign-up" ? "At least 10 characters" : ""}
        />
      </Field>

      {formError && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      )}

      <Button type="submit" size="lg" variant="brand" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {mode === "sign-in" ? "Sign in" : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {mode === "sign-in" ? "New to DUO? " : "Already have an account? "}
        <Link href={otherHref} className="font-semibold text-foreground underline-offset-4 hover:underline">
          {mode === "sign-in" ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactElement<React.ComponentProps<"input">>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, {
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? `${id}-error` : undefined,
      })}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
