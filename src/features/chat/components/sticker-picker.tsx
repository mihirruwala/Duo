"use client";

/* eslint-disable @next/next/no-img-element -- static SVG stickers from /public */
import { STICKERS, type StickerId } from "@/shared/chat";

export function StickerPicker({ onPick }: { onPick: (id: StickerId) => void }) {
  return (
    <div className="w-72">
      <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">DUO stickers</p>
      <div className="grid grid-cols-4 gap-1.5">
        {STICKERS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            aria-label={`Send sticker: ${s.label}`}
            className="grid aspect-square place-items-center rounded-xl p-1 transition-transform hover:scale-110 hover:bg-ink-3 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img src={`/stickers/${s.id}.svg`} alt="" width={56} height={56} draggable={false} />
          </button>
        ))}
      </div>
    </div>
  );
}
