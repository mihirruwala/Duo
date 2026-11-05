import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What DUO and the DUO Control extension do with your data.",
};

const CONTACT = "ruwalamihir@gmail.com";
const UPDATED = "5 November 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 py-10 text-[0.97rem] leading-relaxed text-muted-foreground [&_strong]:text-foreground">
      <Link href="/" aria-label="DUO home" className="w-fit">
        <Wordmark />
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-extrabold text-foreground">Privacy</h1>
        <p>Last updated {UPDATED}.</p>
        <p>
          DUO is a private video-call space for two people, and DUO Control is its optional Chrome extension. This page covers
          both. The short version: we keep what&apos;s needed for your room to work, nothing is sold or used for ads, there are no
          analytics or trackers, and calls are never recorded.
        </p>
      </header>

      <Section title="The DUO Control extension">
        <p>
          The extension does one thing: it lets the person you&apos;re on a DUO call with see and, if you approve, control one
          browser tab you choose to share.
        </p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <strong>It only acts on the tab you pick.</strong> Nothing happens until you click &ldquo;Share this tab with
            DUO&rdquo; in its popup. It has no access to other tabs, your browsing history, bookmarks, passwords or cookies, and
            it has no permission to read websites in general.
          </li>
          <li>
            <strong>Tab video.</strong> While you share, it captures that tab&apos;s picture and sound and hands it to the DUO
            call you have open. From there it travels like the rest of the call (end-to-end encrypted unless the room&apos;s host
            turned that off). It is not recorded or stored.
          </li>
          <li>
            <strong>Remote control.</strong> When your person asks for control and you approve, their clicks, scrolling and typing
            are applied to that one tab using Chrome&apos;s debugger interface. Pasting and browser shortcuts are blocked. Control
            ends when you revoke it, when the time limit runs out, when you stop sharing, or when you press the emergency-stop
            shortcut. Chrome shows its own &ldquo;debugging this browser&rdquo; bar the whole time.
          </li>
          <li>
            <strong>Tab title and address.</strong> The extension reads the shared tab&apos;s title to show you what you&apos;re
            sharing, and checks its address on your computer to refuse pages that shouldn&apos;t be controlled (such as browser
            settings or DUO itself). Neither is sent to your person or to us.
          </li>
          <li>
            <strong>Notifications.</strong> It shows a notification when your person asks for control.
          </li>
          <li>
            It stores nothing, makes no network requests of its own, talks only to DUO&apos;s own site, and runs no code
            downloaded from elsewhere.
          </li>
        </ul>
      </Section>

      <Section title="What DUO stores">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <strong>Your account:</strong> email address, password (handled by our sign-in provider and stored hashed), display
            name and avatar colour.
          </li>
          <li>
            <strong>Your rooms:</strong> who&apos;s in each room, chat messages, reactions, read receipts, photos, files, voice
            and video notes, saved Moments and shared lists. Only the two members of a room can see them. They are not end-to-end
            encrypted, so they are protected by access rules in our database rather than by your own keys.
          </li>
          <li>
            <strong>A remote-control log:</strong> who asked whom for control, when, and how it ended. It never contains what was
            clicked or typed.
          </li>
          <li>
            <strong>Short-lived counters</strong> used to rate-limit requests and stop abuse.
          </li>
        </ul>
        <p>
          Calls themselves (video, audio, screen shares) are not stored anywhere. They pass through our call provider, end-to-end
          encrypted by default, and are never recorded.
        </p>
      </Section>

      <Section title="Who handles it">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <strong>Supabase</strong> (database, sign-in, file storage and realtime messages), hosted in Ireland.
          </li>
          <li>
            <strong>LiveKit Cloud</strong> relays calls. With end-to-end encryption on, it only ever sees encrypted media.
          </li>
          <li>
            <strong>Vercel</strong> hosts the website.
          </li>
          <li>
            <strong>YouTube</strong> plays videos you watch together, through its privacy-enhanced player (youtube-nocookie.com).
            YouTube&apos;s own privacy policy applies to that player.
          </li>
          <li>
            <strong>GIPHY</strong> receives the words you search for when picking a GIF. Searches go through our server, so GIPHY
            doesn&apos;t learn who you are.
          </li>
        </ul>
      </Section>

      <Section title="Cookies and local storage">
        <p>
          DUO sets one sign-in cookie so you stay signed in. Your browser also keeps a few preferences, like chat size, alert
          settings and your chosen camera, in local storage on your device. There are no advertising or tracking cookies.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p>
          In Settings you can delete your account. That removes your account, the rooms you host with everything in them, and the
          files you uploaded elsewhere. Deleting a single room removes its messages and files too. Uninstalling the extension
          removes it completely; it keeps nothing.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions or requests:{" "}
          <a href={`mailto:${CONTACT}`} className="font-semibold text-coral underline-offset-4 hover:underline">
            {CONTACT}
          </a>
          .
        </p>
      </Section>
    </main>
  );
}
