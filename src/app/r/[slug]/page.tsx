import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { AppHeader } from "@/components/duo/app-header";
import { PageSlide } from "@/components/duo/page-slide";
import { DuoAvatar } from "@/components/duo/avatar";
import { SetupRequired } from "@/components/duo/setup-required";
import { Button } from "@/components/ui/button";
import { RoomExperience } from "@/features/call/components/room-experience";
import { E2eeSetting } from "@/features/rooms/components/e2ee-toggle";
import { NewInviteButton } from "@/features/rooms/components/new-invite-button";
import { RoomMembershipActions } from "@/features/rooms/components/room-membership-actions";
import { getMyProfile, getRoomBySlug, type RoomMember, type RoomWithMembers } from "@/features/rooms/server/queries";
import { isConfigured } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Room", referrer: "no-referrer" };

export default async function RoomPage({ params }: PageProps<"/r/[slug]">) {
  if (!isConfigured()) return <SetupRequired />;
  const { slug } = await params;
  const { supabase, user } = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=/r/${encodeURIComponent(slug)}`);

  const [profile, room] = await Promise.all([getMyProfile(supabase, user.id), getRoomBySlug(supabase, slug)]);
  if (!room) return <RoomNotFound />;

  const me = room.members.find((m) => m.userId === user.id)!;
  const partner = room.members.find((m) => m.userId !== user.id) ?? null;

  return (
    <PageSlide>
      <div className="flex min-h-dvh flex-col">
        {/* Phones get the room's own top bar instead (in the chat screen). */}
        <div className="max-sm:hidden">
          <AppHeader name={profile?.display_name ?? "You"} hue={profile?.avatar_hue ?? 20} />
        </div>
        <div className="mx-auto w-full max-w-6xl px-4 pb-2 max-sm:hidden sm:px-6">
          <Link
            href="/home"
            transitionTypes={["nav-back"]}
            className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> All rooms
          </Link>
        </div>
        <RoomExperience
          slug={room.slug}
          roomId={room.id}
          roomName={room.name}
          me={{ id: me.userId, name: me.displayName, hue: me.avatarHue }}
          partner={partner ? { id: partner.userId, name: partner.displayName, hue: partner.avatarHue } : null}
          gifsEnabled={Boolean(process.env.GIPHY_API_KEY)}
          aside={<RoomDetails room={room} me={me} partner={partner} />}
        />
      </div>
    </PageSlide>
  );
}

function RoomDetails({ room, me, partner }: { room: RoomWithMembers; me: RoomMember; partner: RoomMember | null }) {
  return (
    <div className="surface flex flex-col gap-5 rounded-[2rem] p-6 max-sm:border-0 max-sm:bg-transparent max-sm:p-1 max-sm:shadow-none">
      <p className="inline-flex items-center gap-1.5 text-sm text-mint">
        <Lock className="size-3.5" aria-hidden /> Private room · {partner ? "locked to you two" : "1 seat open"}
      </p>
      <ul className="flex flex-col gap-3" aria-label="People in this room" data-testid="room-members">
        <Person member={me} label={me.role === "host" ? "You · host" : "You"} />
        {partner ? (
          <Person member={partner} label={partner.role === "host" ? "Host" : "Guest"} />
        ) : (
          <li className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full border-2 border-dashed border-ink-4 text-muted-foreground">
              ?
            </span>
            <span className="text-sm text-muted-foreground">Waiting for your person</span>
          </li>
        )}
      </ul>
      {!partner && me.role === "host" && (
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-ink-1/60 p-4">
          <p className="text-sm text-muted-foreground">Lost the link? Issue a new one. The old link stops working.</p>
          <NewInviteButton roomId={room.id} />
        </div>
      )}
      <E2eeSetting roomId={room.id} enabled={room.e2ee_enabled} isHost={me.role === "host"} />
      <RoomMembershipActions roomId={room.id} slug={room.slug} role={me.role} />
    </div>
  );
}

function Person({ member, label }: { member: RoomMember; label: string }) {
  return (
    <li className="flex items-center gap-3">
      <DuoAvatar name={member.displayName} hue={member.avatarHue} />
      <span className="flex flex-col">
        <span className="font-bold">{member.displayName}</span>
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
