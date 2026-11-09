"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A phone sheet: slides up from the bottom like the system ones. `full` covers the whole screen
 * (the call setup); otherwise it's a card over a dimmed backdrop that a tap outside closes.
 */
export function PhoneSheet({
  open,
  onClose,
  title,
  full = false,
  children,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  full?: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      {!full && <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/55" />}
      <div
        className={cn(
          "animate-sheet-up absolute inset-x-0 bottom-0 flex flex-col bg-ink-1",
          full
            ? "top-0 pt-[env(safe-area-inset-top)]"
            : "max-h-[88dvh] rounded-t-[1.75rem] border-t border-white/10 pb-[env(safe-area-inset-bottom)] shadow-2xl",
        )}
      >
        <header className="relative flex shrink-0 items-center justify-center px-4 pt-2 pb-3">
          {!full && <span className="absolute top-2 h-1 w-10 rounded-full bg-white/20" aria-hidden />}
          <h2 className={cn("text-[17px] font-bold", !full && "mt-3")}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
            className={cn(
              "absolute right-3 grid size-9 place-items-center rounded-full bg-ink-3 text-muted-foreground active:scale-95",
              !full && "top-4",
            )}
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
