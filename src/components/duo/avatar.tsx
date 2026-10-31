import { cn } from "@/lib/utils";

const SIZES = { sm: "size-8 text-sm", md: "size-10 text-base", lg: "size-14 text-xl", xl: "size-20 text-3xl" } as const;

/** Initial-on-colour avatar. Hue comes from the profile so each person keeps their colour. */
export function DuoAvatar({
  name,
  hue,
  size = "md",
  className,
}: {
  name: string;
  hue: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-display font-bold text-ink-0 ring-2 ring-ink-1",
        SIZES[size],
        className,
      )}
      style={{ background: `linear-gradient(140deg, oklch(0.82 0.12 ${hue}), oklch(0.7 0.15 ${(hue + 40) % 360}))` }}
    >
      {initial}
    </span>
  );
}
