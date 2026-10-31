"use client";

import { MORE_REACTIONS, QUICK_REACTIONS } from "@/shared/chat";

export function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="flex w-64 flex-col gap-2" role="group" aria-label="Pick a reaction">
      <div className="flex justify-between">
        {QUICK_REACTIONS.map((e) => (
          <EmojiButton key={e} emoji={e} onPick={onPick} large />
        ))}
      </div>
      <div className="grid grid-cols-8 gap-0.5 border-t border-border pt-2">
        {MORE_REACTIONS.map((e) => (
          <EmojiButton key={e} emoji={e} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function EmojiButton({ emoji, onPick, large }: { emoji: string; onPick: (e: string) => void; large?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onPick(emoji)}
      aria-label={`React ${emoji}`}
      className={`grid place-items-center rounded-lg transition-transform hover:scale-125 hover:bg-ink-3 ${large ? "size-9 text-2xl" : "size-7 text-lg"}`}
    >
      {emoji}
    </button>
  );
}
