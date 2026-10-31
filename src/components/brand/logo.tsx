import { cn } from "@/lib/utils";

/**
 * DUO mark: two overlapping rounded blobs (you + them). Where they overlap
 * glows: the shared space. Rendered as inline SVG so it scales crisply and needs no asset.
 */
export function LogoMark({ className, title = "DUO" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 48 32" className={cn("h-8 w-12", className)} role="img" aria-label={title}>
      <defs>
        <clipPath id="duo-left">
          <rect x="2" y="2" width="28" height="28" rx="14" />
        </clipPath>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="14" fill="var(--duo-coral)" />
      <rect x="18" y="2" width="28" height="28" rx="14" fill="var(--duo-violet)" />
      <rect x="18" y="2" width="28" height="28" rx="14" fill="oklch(0.92 0.06 350)" clipPath="url(#duo-left)" />
      <circle cx="11" cy="15" r="2.2" fill="var(--duo-ink-0)" />
      <circle cx="37" cy="15" r="2.2" fill="var(--duo-ink-0)" />
    </svg>
  );
}

export function Wordmark({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const text = { sm: "text-xl", md: "text-2xl", lg: "text-5xl" }[size];
  const mark = { sm: "h-6 w-9", md: "h-8 w-12", lg: "h-14 w-20" }[size];
  return (
    <span className={cn("inline-flex items-center gap-2 select-none", className)}>
      <LogoMark className={mark} title="" />
      <span className={cn("font-display font-extrabold tracking-tight lowercase", text)} aria-label="DUO">
        duo
      </span>
    </span>
  );
}
