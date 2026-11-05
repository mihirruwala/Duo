import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/features/auth/components/password-forms";

export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  const { error } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-3xl font-bold">Forgot your password?</h1>
      <p className="mb-6 text-muted-foreground">Enter your email and we&apos;ll send you a link to choose a new one.</p>
      <ForgotPasswordForm linkExpired={error === "link"} />
    </>
  );
}
