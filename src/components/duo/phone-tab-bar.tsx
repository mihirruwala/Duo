"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessagesSquare, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/home", label: "Rooms", Icon: MessagesSquare },
  { href: "/settings", label: "Settings", Icon: Settings },
] as const;

/** Phones only: the app's bottom tab bar. Pages that show it leave room for it (`max-sm:pb-28`). */
export function PhoneTabBar() {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-2 border-t border-white/8 bg-ink-1/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden"
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = path === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-semibold",
              active ? "text-coral" : "text-muted-foreground",
            )}
          >
            <Icon className="size-6" strokeWidth={active ? 2.2 : 1.8} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phones only: the big title at the top of a tab, under the status bar. */
export function PhoneLargeTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-2 sm:hidden">
      <h1 className="text-[34px] leading-tight font-extrabold tracking-tight">{title}</h1>
      {action}
    </header>
  );
}
