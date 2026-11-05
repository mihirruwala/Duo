import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/features/auth/components/password-forms";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a new password" };

/** Reached from the reset email, which signs the person in for this one purpose. */
export default async function ResetPasswordPage() {
  const { user } = await getCurrentUser();
  if (!user) redirect("/forgot-password?error=link");
  return (
    <>
      <h1 className="mb-1 text-3xl font-bold">Choose a new password</h1>
      <p className="mb-6 text-muted-foreground">You&apos;ll stay signed in on this device.</p>
      <ResetPasswordForm email={user.email ?? ""} />
    </>
  );
}
