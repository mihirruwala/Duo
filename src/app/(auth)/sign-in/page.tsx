import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/components/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-3xl font-bold">Welcome back</h1>
      <p className="mb-6 text-muted-foreground">Your person is probably waiting.</p>
      <AuthForm mode="sign-in" next={typeof next === "string" ? next : undefined} />
    </>
  );
}
