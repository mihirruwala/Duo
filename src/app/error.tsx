"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Wordmark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

/** Any route crash lands here: a friendly page with a retry, never a stack trace. */
export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // Digest only (no message): server error details never reach the browser in production.
    const digest = error && typeof error === "object" && "digest" in error ? String(error.digest) : undefined;
    console.error("DUO route error", digest ?? "");
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-6 text-center" role="alert">
      <Wordmark />
      <div className="text-5xl" aria-hidden>
        🫠
      </div>
      <h1 className="text-3xl font-bold">Something went sideways</h1>
      <p className="text-muted-foreground">
        That wasn&apos;t supposed to happen. Your rooms and messages are safe. Try again, or head home.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/home">Back to your rooms</Link>
        </Button>
      </div>
    </main>
  );
}
