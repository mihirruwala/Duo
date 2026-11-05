import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/components/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-3xl font-bold">Welcome back</h1>
      <p className="mb-6 text-muted-foreground">Your person is probably waiting.</p>
      {(error === "confirm" || error === "link") && (
        <p
          role="alert"
          className="mb-5 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          That link has expired or was already used. Sign in below, or create your account again if you never finished.
        </p>
      )}
      <AuthForm mode="sign-in" next={typeof next === "string" ? next : undefined} />
    </>
  );
}
