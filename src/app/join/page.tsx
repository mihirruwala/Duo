import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";
import { SetupRequired } from "@/components/duo/setup-required";
import { RedeemInvite } from "@/features/rooms/components/redeem-invite";
import { isConfigured } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Join a room" };

export default async function JoinPage() {
  if (!isConfigured()) return <SetupRequired />;
  const { user } = await getCurrentUser();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Link href="/" aria-label="DUO home">
        <Wordmark />
      </Link>
      <div className="surface w-full max-w-md rounded-[2rem] p-6 sm:p-8">
        <RedeemInvite signedIn={Boolean(user)} />
      </div>
    </main>
  );
}
