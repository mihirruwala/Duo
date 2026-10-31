import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";
import { SetupRequired } from "@/components/duo/setup-required";
import { isConfigured } from "@/lib/env";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  if (!isConfigured()) return <SetupRequired />;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Link href="/" aria-label="DUO home">
        <Wordmark size="md" />
      </Link>
      <div className="surface w-full max-w-md rounded-[2rem] p-6 sm:p-8">{children}</div>
    </main>
  );
}
