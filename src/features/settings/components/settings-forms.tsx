"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Bell, Loader2, LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { DuoAvatar } from "@/components/duo/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { getAlertPrefs, notificationPermission, requestNotificationPermission, setAlertPrefs } from "@/features/presence/alerts";
import { getBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/shared/errors";
import { ChangePasswordForm } from "@/features/auth/components/password-forms";

const nameSchema = z.string().trim().min(1, "Your name can't be empty.").max(40, "Keep it under 40 characters.");

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="surface flex flex-col gap-4 rounded-[1.75rem] p-6" aria-labelledby={`s-${title}`}>
      <div>
        <h2 id={`s-${title}`} className="text-xl font-bold">
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function ProfileForm({ userId, initialName, initialHue }: { userId: string; initialName: string; initialHue: number }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [hue, setHue] = useState(initialHue);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = name.trim() !== initialName || hue !== initialHue;

  return (
    <Section title="Profile" description="How you appear to the people you share rooms with.">
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = nameSchema.safeParse(name);
          if (!parsed.success) return setError(parsed.error.issues[0]!.message);
          setError(null);
          startTransition(async () => {
            const { error } = await getBrowserClient()
              .from("profiles")
              .update({ display_name: parsed.data, avatar_hue: hue })
              .eq("id", userId);
            if (error) return setError(friendlyError(error));
            toast.success("Profile saved. Your person will see it next time they load the room.");
            router.refresh();
          });
        }}
      >
        <div className="flex items-center gap-4">
          <DuoAvatar name={name || "?"} hue={hue} size="xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="display-name">Name</Label>
            <Input
              id="display-name"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "display-name-error" : undefined}
            />
            {error && (
              <p id="display-name-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label id="hue-label">Colour</Label>
          <Slider
            min={0}
            max={359}
            step={1}
            value={[hue]}
            onValueChange={([v]) => setHue(v ?? hue)}
            aria-labelledby="hue-label"
            thumbLabel="Colour"
            className="[&_[data-slot=slider-track]]:bg-[linear-gradient(90deg,oklch(0.8_0.12_0),oklch(0.8_0.12_60),oklch(0.8_0.12_120),oklch(0.8_0.12_180),oklch(0.8_0.12_240),oklch(0.8_0.12_300),oklch(0.8_0.12_359))]"
          />
        </div>
        <Button type="submit" className="w-fit" disabled={!dirty || pending}>
          {pending && <Loader2 className="animate-spin" />} Save changes
        </Button>
      </form>
    </Section>
  );
}

export function AlertsSection() {
  const [prefs, setPrefs] = useState({ sound: true, notify: true });
  const [perm, setPerm] = useState<ReturnType<typeof notificationPermission>>("default");
  useEffect(() => {
    const t = setTimeout(() => {
      setPrefs(getAlertPrefs());
      setPerm(notificationPermission());
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const update = (p: typeof prefs) => {
    setPrefs(p);
    setAlertPrefs(p);
  };

  return (
    <Section title="When your person arrives" description="Saved on this device.">
      <label className="flex items-center justify-between gap-3 text-sm font-semibold">
        Play a chime
        <Switch checked={prefs.sound} onCheckedChange={(sound) => update({ ...prefs, sound })} aria-label="Play a chime" />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm font-semibold">
        Show a notification when DUO isn&apos;t in front
        <Switch
          checked={prefs.notify && perm === "granted"}
          disabled={perm === "denied" || perm === "unsupported"}
          onCheckedChange={async (notify) => {
            if (notify && perm !== "granted") {
              const r = await requestNotificationPermission();
              setPerm(r);
              if (r !== "granted") return;
            }
            update({ ...prefs, notify });
          }}
          aria-label="Show notifications"
        />
      </label>
      {perm === "unsupported" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Bell className="size-4" /> Notifications aren&apos;t available here yet. The chime still plays while DUO is open.
        </p>
      )}
      {perm === "denied" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Bell className="size-4" /> Notifications are blocked. Allow them for DUO in your browser&apos;s site settings.
        </p>
      )}
    </Section>
  );
}

export function AccountSection({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Section title="Account">
      <p className="text-sm text-muted-foreground">
        Signed in as <span className="font-semibold text-foreground">{email}</span>
      </p>
      <ChangePasswordForm email={email} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={async () => {
            await getBrowserClient().auth.signOut();
            router.replace("/");
            router.refresh();
          }}
        >
          <LogOut /> Sign out
        </Button>
        <Button variant="destructive" onClick={() => setOpen(true)} data-testid="delete-account">
          <Trash2 /> Delete account
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setPassword("");
            setConfirm("");
            setError(null);
          }
        }}
      >
        <DialogContent className="rounded-[1.75rem] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl">Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your profile, every room you host (with its messages, photos, files and Moments, for both
              of you), and the files you shared in other rooms. It can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              startTransition(async () => {
                const res = await fetch("/api/account/delete", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ password }),
                });
                const body = (await res.json().catch(() => null)) as { message?: string } | null;
                if (!res.ok) return setError(body?.message ?? "Couldn't delete your account.");
                router.replace("/?deleted=1");
                router.refresh();
              });
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="delete-password">Your password</Label>
              <Input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="delete-confirm">
                Type <span className="font-mono">DELETE</span> to confirm
              </Label>
              <Input id="delete-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" disabled={pending || confirm !== "DELETE" || !password}>
                {pending && <Loader2 className="animate-spin" />} Delete forever
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
