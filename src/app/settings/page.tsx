import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/duo/app-header";
import { SetupRequired } from "@/components/duo/setup-required";
import { AccountSection, AlertsSection, ProfileForm } from "@/features/settings/components/settings-forms";
import { getMyProfile } from "@/features/rooms/server/queries";
import { isConfigured } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  if (!isConfigured()) return <SetupRequired />;
  const { supabase, user } = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/settings");
  const profile = await getMyProfile(supabase, user.id);
  const name = profile?.display_name ?? "You";
  const hue = profile?.avatar_hue ?? 20;

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader name={name} hue={hue} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pt-2 pb-16 sm:px-6">
        <Link href="/home" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> All rooms
        </Link>
        <h1 className="text-4xl font-extrabold">Settings</h1>
        <ProfileForm userId={user.id} initialName={name} initialHue={hue} />
        <AlertsSection />
        <AccountSection email={user.email ?? ""} />
      </main>
    </div>
  );
}
