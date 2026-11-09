import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ChevronRight, Hourglass, Plus } from "lucide-react";
import { PhoneLargeTitle, PhoneTabBar } from "@/components/duo/phone-tab-bar";
import { AppHeader } from "@/components/duo/app-header";
import { DuoAvatar } from "@/components/duo/avatar";
import { SetupRequired } from "@/components/duo/setup-required";
import { Button } from "@/components/ui/button";
import { CreateRoomDialog } from "@/features/rooms/components/create-room-dialog";
import { JoinCodeForm } from "@/features/rooms/components/join-code-form";
import { AlertsControl, HomePresence, RoomPresenceStatus } from "@/features/presence/components/home-presence";
import { NewInviteButton } from "@/features/rooms/components/new-invite-button";
import { getMyProfile, listMyRooms, type RoomWithMembers } from "@/features/rooms/server/queries";
import { isConfigured } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your rooms" };

export default async function HomePage() {
  if (!isConfigured()) return <SetupRequired />;
  const { supabase, user } = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/home");

  const [profile, rooms] = await Promise.all([getMyProfile(supabase, user.id), listMyRooms(supabase)]);
  const name = profile?.display_name ?? "You";

  return (
    <div className="flex min-h-dvh flex-col max-sm:pb-28">
      <div className="max-sm:hidden">
        <AppHeader name={name} hue={profile?.avatar_hue ?? 20} />
      </div>
      <PhoneLargeTitle
        title="Rooms"
        action={
          <CreateRoomDialog
            trigger={
              <button
                type="button"
                aria-label="New room"
                className="mb-1.5 grid size-10 place-items-center rounded-full bg-coral text-ink-0 active:scale-95"
              >
                <Plus className="size-5" strokeWidth={2.6} />
              </button>
            }
          />
        }
      />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 pt-4 pb-16 max-sm:gap-8 max-sm:px-0 max-sm:pt-2 max-sm:pb-4 sm:px-6">
        {/* Phones: the invite box sits under the list; the greeting and buttons are desktop-only. */}
        <section className="flex flex-col justify-between gap-6 max-sm:order-last max-sm:px-4 md:flex-row md:items-end">
          <div className="max-sm:hidden">
            <h1 className="text-4xl font-extrabold sm:text-5xl">Hey {name} 👋</h1>
            <p className="mt-2 text-lg text-muted-foreground">Pick up where you left off, or open a new space.</p>
            <div className="mt-3">
              <AlertsControl />
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <p className="px-1 text-[13px] font-semibold text-muted-foreground uppercase sm:hidden">Have an invite?</p>
            <JoinCodeForm />
            <span className="max-sm:hidden">
              <CreateRoomDialog />
            </span>
          </div>
        </section>

        {rooms.length === 0 ? (
          <EmptyState />
        ) : (
          <HomePresence
            myId={user.id}
            rooms={rooms.map((r) => ({
              id: r.id,
              slug: r.slug,
              name: r.name,
              partnerName: r.members.find((m) => m.userId !== user.id)?.displayName ?? null,
            }))}
          >
            <ul
              className="grid gap-4 max-sm:mx-4 max-sm:gap-0 max-sm:divide-y max-sm:divide-white/6 max-sm:overflow-hidden max-sm:rounded-2xl max-sm:bg-ink-2 sm:grid-cols-2 lg:grid-cols-3"
              aria-label="Your rooms"
            >
              {rooms.map((room) => (
                <RoomCard key={room.id} room={room} myId={user.id} />
              ))}
            </ul>
          </HomePresence>
        )}
      </main>
      <PhoneTabBar />
    </div>
  );
}

function RoomCard({ room, myId }: { room: RoomWithMembers; myId: string }) {
  const partner = room.members.find((m) => m.userId !== myId);
  const isHost = room.host_id === myId;
  const inviteLive = room.has_open_invite && room.invite_expires_at && new Date(room.invite_expires_at) > new Date();

  return (
    <li
      className="surface group relative flex flex-col gap-5 rounded-3xl p-5 max-sm:flex-row max-sm:items-center max-sm:gap-3 max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:px-4 max-sm:py-3 max-sm:shadow-none max-sm:active:bg-white/5"
      data-testid="room-card"
    >
      {/* Phones: a list row (who's in it, the room, live status, a chevron); the whole row opens it. */}
      <span className="shrink-0 sm:hidden" aria-hidden>
        {partner ? (
          <DuoAvatar name={partner.displayName} hue={partner.avatarHue} size="md" />
        ) : (
          <span className="grid size-10 place-items-center rounded-full border-2 border-dashed border-ink-4 text-muted-foreground">
            ?
          </span>
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-5 max-sm:flex-1 max-sm:gap-0.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="truncate text-xl font-bold max-sm:text-[17px]">{room.name}</h2>
          <div className="flex -space-x-3 max-sm:hidden">
            {room.members.map((m) => (
              <DuoAvatar key={m.userId} name={m.displayName} hue={m.avatarHue} size="sm" />
            ))}
          </div>
        </div>
        {partner ? (
          <RoomPresenceStatus roomId={room.id} slug={room.slug} partnerName={partner.displayName} />
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Hourglass className="size-4 text-sun" aria-hidden />
            {inviteLive ? "Invite sent, waiting for your person" : "Invite expired, send a new one"}
          </p>
        )}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 max-sm:mt-0">
        <Button
          asChild
          size="sm"
          className="max-sm:absolute max-sm:inset-0 max-sm:h-auto max-sm:rounded-none max-sm:bg-transparent max-sm:text-transparent max-sm:shadow-none"
        >
          <Link href={`/r/${room.slug}`}>
            Enter <ArrowRight />
          </Link>
        </Button>
        {isHost && !partner && (
          <span className="relative z-[1]">
            <NewInviteButton roomId={room.id} />
          </span>
        )}
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground sm:hidden" aria-hidden />
    </li>
  );
}

function EmptyState() {
  return (
    <div className="surface flex flex-col items-center gap-4 rounded-[2rem] px-6 py-16 text-center max-sm:mx-4 max-sm:py-12">
      <div className="text-5xl" aria-hidden>
        🛋️
      </div>
      <h2 className="text-2xl font-bold">No rooms yet</h2>
      <p className="max-w-sm text-muted-foreground">
        Create a room and send the invite link to your person, or paste a link someone sent you.
      </p>
      <CreateRoomDialog />
    </div>
  );
}
