import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/components/auth-form";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
  title: "Create account",
};

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-3xl font-bold">Make some space</h1>
      <p className="mb-6 text-muted-foreground">Create an account to start a private room.</p>
      <AuthForm mode="sign-up" next={typeof next === "string" ? next : undefined} />
    </>
  );
}
