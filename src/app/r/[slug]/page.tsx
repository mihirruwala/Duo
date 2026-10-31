import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Lock, Video } from "lucide-react";
import { AppHeader } from "@/components/duo/app-header";
import { DuoAvatar } from "@/components/duo/avatar";
import { ComingSoon } from "@/components/duo/coming-soon";
import { SetupRequired } from "@/components/duo/setup-required";
import { Button } from "@/components/ui/button";
import { NewInviteButton } from "@/features/rooms/components/new-invite-button";
import { RoomMembershipActions } from "@/features/rooms/components/room-membership-actions";
import { getMyProfile, getRoomBySlug } from "@/features/rooms/server/queries";
import { isConfigured } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";
import { FEATURES } from "@/shared/features";

export const metadata: Metadata = { title: "Room", referrer: "no-referrer" };

export default async function RoomPage({ params }: PageProps<"/r/[slug]">) {
  if (!isConfigured()) return <SetupRequired />;
  const { slug } = await params;
  const { supabase, user } = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=/r/${encodeURIComponent(slug)}`);

  const [profile, room] = await Promise.all([getMyProfile(supabase, user.id), getRoomBySlug(supabase, slug)]);
  if (!room) return <RoomNotFound />;

  const me = room.members.find((m) => m.userId === user.id)!;
  const partner = room.members.find((m) => m.userId !== user.id);

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader name={profile?.display_name ?? "You"} hue={profile?.avatar_hue ?? 20} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-4 pb-16 sm:px-6">
        <Link href="/home" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> All rooms
        </Link>

        <section className="surface flex flex-col gap-8 rounded-[2rem] p-6 sm:p-10">
          <div className="flex flex-col gap-2">
            <p className="inline-flex items-center gap-1.5 text-sm text-mint">
              <Lock className="size-3.5" aria-hidden /> Private room · {partner ? "locked to you two" : "1 seat open"}
            </p>
            <h1 className="text-4xl font-extrabold" data-testid="room-name">
              {room.name}
            </h1>
          </div>

          <ul className="flex flex-wrap items-center gap-6" aria-label="People in this room" data-testid="room-members">
            <Person name={me.displayName} hue={me.avatarHue} label={me.role === "host" ? "You · host" : "You"} />
            <span className="font-display text-3xl text-muted-foreground" aria-hidden>
              +
            </span>
            {partner ? (
              <Person name={partner.displayName} hue={partner.avatarHue} label={partner.role === "host" ? "Host" : "Guest"} />
            ) : (
              <li className="flex items-center gap-3">
                <span className="grid size-14 place-items-center rounded-full border-2 border-dashed border-ink-4 text-2xl text-muted-foreground">
                  ?
                </span>
                <span className="text-sm text-muted-foreground">Waiting for your person</span>
              </li>
            )}
          </ul>

          {!partner && me.role === "host" && (
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-ink-1/60 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">Lost the link? Issue a new one. The old link stops working.</p>
              <NewInviteButton roomId={room.id} />
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-ink-1/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-ink-3 text-coral">
                <Video className="size-5" aria-hidden />
              </span>
              <span className="font-semibold">Video call</span>
            </span>
            {FEATURES.video ? null : <ComingSoon />}
          </div>
        </section>

        <RoomMembershipActions roomId={room.id} role={me.role} />
      </main>
    </div>
  );
}

function Person({ name, hue, label }: { name: string; hue: number; label: string }) {
  return (
    <li className="flex items-center gap-3">
      <DuoAvatar name={name} hue={hue} size="lg" />
      <span className="flex flex-col">
        <span className="font-bold">{name}</span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </span>
    </li>
  );
}

function RoomNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-5xl" aria-hidden>
        🚪
      </div>
      <h1 className="text-3xl font-bold" data-testid="room-not-found">
        Room not found
      </h1>
      <p className="text-muted-foreground">This room doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Button asChild>
        <Link href="/home">Back to your rooms</Link>
      </Button>
    </main>
  );
}
