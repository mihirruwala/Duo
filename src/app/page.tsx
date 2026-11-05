import Link from "next/link";
import { ArrowRight, Clapperboard, MessageCircleHeart, MousePointer2, Sparkles } from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import { ComingSoon } from "@/components/duo/coming-soon";
import { Button } from "@/components/ui/button";
import { JoinCodeForm } from "@/features/rooms/components/join-code-form";
import { isConfigured } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";
import { FEATURES, type FeatureKey } from "@/shared/features";

const PILLARS: { icon: typeof MousePointer2; title: string; body: string; feature: FeatureKey; tint: string }[] = [
  {
    icon: MousePointer2,
    title: "Share & hand over the mouse",
    body: "Share a tab and let your person click, scroll and type in it, only after you say yes. Revoke in one tap.",
    feature: "remoteControl",
    tint: "text-coral",
  },
  {
    icon: MessageCircleHeart,
    title: "Chat that keeps up",
    body: "Replies, reactions, GIFs, stickers, photos, voice notes and shared lists, right beside the call and saved for next time.",
    feature: "chat",
    tint: "text-violet",
  },
  {
    icon: Sparkles,
    title: "DUO Studio",
    body: "Cat ears, VHS fuzz, a cozy room behind you. Live effects your person actually sees.",
    feature: "studio",
    tint: "text-mint",
  },
  {
    icon: Clapperboard,
    title: "Watch together",
    body: "Press play on a YouTube video for both of you at once, or share the tab your show is playing in.",
    feature: "watchTogether",
    tint: "text-sun",
  },
];

export default async function LandingPage() {
  const user = isConfigured() ? (await getCurrentUser()).user : null;
  const startHref = user ? "/home" : "/sign-up?next=/home";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" aria-label="DUO home">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-2">
          {user ? (
            <Button asChild variant="outline">
              <Link href="/home">Your rooms</Link>
            </Button>
          ) : (
            <Button asChild variant="ghost">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          )}
        </nav>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-4 pt-6 pb-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-12">
        <section className="flex flex-col gap-7">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-ink-2/70 px-3 py-1 text-sm text-muted-foreground">
            <span className="size-2 rounded-full bg-mint" aria-hidden /> Invite-only. Just the two of you.
          </p>
          <h1 className="text-5xl leading-[1.02] font-extrabold sm:text-6xl lg:text-7xl">
            A private space <br className="hidden sm:block" />
            for <span className="text-gradient">two</span>.
          </h1>
          <p className="max-w-lg text-lg text-muted-foreground">
            Connect, share your screen, hand over control and have fun, in a room nobody else can find, let alone enter.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg" variant="brand">
              <Link href={startHref}>
                Start a call <ArrowRight />
              </Link>
            </Button>
            <span className="hidden text-sm text-muted-foreground sm:inline">or</span>
            <JoinCodeForm />
          </div>
        </section>

        <HeroArt />
      </main>

      <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6" aria-labelledby="pillars">
        <h2 id="pillars" className="sr-only">
          What you can do in DUO
        </h2>
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map(({ icon: Icon, title, body, feature, tint }) => (
            <li key={title} className="surface flex flex-col gap-3 rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <span className={`grid size-11 place-items-center rounded-2xl bg-ink-3 ${tint}`}>
                  <Icon className="size-5" aria-hidden />
                </span>
                {!FEATURES[feature] && <ComingSoon />}
              </div>
              <h3 className="text-xl font-bold">{title}</h3>
              <p className="text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-sm text-muted-foreground sm:px-6">
        No recording. No public rooms. Calls are end-to-end encrypted by default, and chat is saved privately for the two of you.{" "}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
          Privacy
        </Link>
      </footer>
    </div>
  );
}

/** Decorative illustration of two people in a call (aria-hidden, no interactive parts). */
function HeroArt() {
  return (
    <div aria-hidden className="relative mx-auto aspect-[5/4] w-full max-w-lg select-none">
      <div className="absolute inset-0 rounded-[2.5rem] bg-duo-gradient opacity-20 blur-3xl" />
      <div className="absolute top-[6%] left-0 h-[62%] w-[66%] animate-float rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_30%_30%,oklch(0.55_0.12_30),oklch(0.25_0.05_300))] shadow-2xl">
        <div className="absolute bottom-4 left-4 rounded-full bg-black/40 px-3 py-1 text-sm font-semibold backdrop-blur">You</div>
        <div className="absolute top-1/2 left-1/2 grid size-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-coral/90 font-display text-4xl font-extrabold text-ink-0">
          Y
        </div>
      </div>
      <div className="absolute right-0 bottom-[4%] h-[58%] w-[60%] animate-float rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_70%_30%,oklch(0.55_0.12_292),oklch(0.22_0.05_300))] shadow-2xl [animation-delay:-3s]">
        <div className="absolute right-4 bottom-4 rounded-full bg-black/40 px-3 py-1 text-sm font-semibold backdrop-blur">
          Them
        </div>
        <div className="absolute top-1/2 left-1/2 grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-violet/90 font-display text-3xl font-extrabold text-ink-0">
          T
        </div>
        <svg viewBox="0 0 24 24" className="absolute top-[22%] left-[18%] size-7 drop-shadow-lg">
          <path d="M3 2l7 19 2.5-7.5L20 11z" fill="var(--duo-coral)" stroke="var(--duo-ink-0)" strokeWidth="1.5" />
        </svg>
      </div>
      <div className="glass absolute top-[76%] left-[3%] rounded-2xl rounded-bl-md px-4 py-2 text-sm font-medium shadow-xl">
        okay now click the blue one 👀
      </div>
    </div>
  );
}
