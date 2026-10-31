import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";
import { UserMenu } from "@/features/auth/components/user-menu";

export function AppHeader({ name, hue }: { name: string; hue: number }) {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
      <Link href="/home">
        <Wordmark size="sm" />
        <span className="sr-only">: your rooms</span>
      </Link>
      <UserMenu name={name} hue={hue} />
    </header>
  );
}
