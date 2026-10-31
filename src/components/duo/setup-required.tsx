import { Wordmark } from "@/components/brand/logo";

/** Shown instead of crashing when Supabase env vars are missing in local dev. */
export function SetupRequired() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-start justify-center gap-6 px-6">
      <Wordmark size="md" />
      <h1 className="text-3xl font-bold">Almost there: DUO needs its backend.</h1>
      <p className="text-muted-foreground">
        Copy <code className="rounded bg-ink-3 px-1.5 py-0.5 font-mono text-sm">.env.example</code> to{" "}
        <code className="rounded bg-ink-3 px-1.5 py-0.5 font-mono text-sm">.env.local</code>, fill in your Supabase project URL
        and keys, then restart <code className="font-mono text-sm">npm run dev</code>. The README has the full checklist.
      </p>
    </main>
  );
}
