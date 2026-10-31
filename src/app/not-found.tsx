import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <Wordmark />
      <div className="text-5xl" aria-hidden>
        🧭
      </div>
      <h1 className="text-3xl font-bold" data-testid="not-found">
        Nothing here
      </h1>
      <p className="text-muted-foreground">
        This page doesn&apos;t exist. If someone sent you an invite, paste it on the home page.
      </p>
      <Button asChild>
        <Link href="/">Go to DUO</Link>
      </Button>
    </main>
  );
}
