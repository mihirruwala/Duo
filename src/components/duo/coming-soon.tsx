import { cn } from "@/lib/utils";

export function ComingSoon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-sun/30 bg-sun/10 px-2 py-0.5 text-[0.7rem] font-semibold tracking-wide text-sun uppercase",
        className,
      )}
    >
      Coming soon
    </span>
  );
}
