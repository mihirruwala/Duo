import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Hourglass } from "lucide-react";
import { AppHeader } from "@/components/duo/app-header";
import { DuoAvatar } from "@/components/duo/avatar";
import { SetupRequired } from "@/components/duo/setup-required";
import { Button } from "@/components/ui/button";
import { CreateRoomDialog } from "@/features/rooms/components/create-room-dialog";
import { JoinCodeForm } from "@/features/rooms/components/join-code-form";
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
    <div className="flex min-h-dvh flex-col">
      <AppHeader name={name} hue={profile?.avatar_hue ?? 20} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 pt-4 pb-16 sm:px-6">
        <section className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <h1 className="text-4xl font-extrabold sm:text-5xl">Hey {name} 👋</h1>
            <p className="mt-2 text-lg text-muted-foreground">Pick up where you left off, or open a new space.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <JoinCodeForm />
            <CreateRoomDialog />
          </div>
        </section>

        {rooms.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Your rooms">
            {rooms.map((room) => (
              <RoomCard key={room.id} room={room} myId={user.id} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function RoomCard({ room, myId }: { room: RoomWithMembers; myId: string }) {
  const partner = room.members.find((m) => m.userId !== myId);
  const isHost = room.host_id === myId;
  const inviteLive = room.has_open_invite && room.invite_expires_at && new Date(room.invite_expires_at) > new Date();

  return (
    <li className="surface group flex flex-col gap-5 rounded-3xl p-5" data-testid="room-card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="truncate text-xl font-bold">{room.name}</h2>
        <div className="flex -space-x-3">
          {room.members.map((m) => (
            <DuoAvatar key={m.userId} name={m.displayName} hue={m.avatarHue} size="sm" />
          ))}
        </div>
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {partner ? (
          <>
            <span className="size-2 rounded-full bg-violet" aria-hidden /> With {partner.displayName}
          </>
        ) : (
          <>
            <Hourglass className="size-4 text-sun" aria-hidden />
            {inviteLive ? "Invite sent, waiting for your person" : "Invite expired, send a new one"}
          </>
        )}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <Link href={`/r/${room.slug}`}>
            Enter <ArrowRight />
          </Link>
        </Button>
        {isHost && !partner && <NewInviteButton roomId={room.id} />}
      </div>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="surface flex flex-col items-center gap-4 rounded-[2rem] px-6 py-16 text-center">
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
