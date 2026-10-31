"use client";

/* eslint-disable @next/next/no-img-element -- signed private / remote GIF URLs */
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { gifMetaSchema } from "@/shared/chat";
import type { AttachmentRow } from "@/shared/database";
import type { ChatMessage } from "../chat-reducer";
import { useSignedUrl } from "../signed-urls";

export type ViewerItem = { message: ChatMessage; attachment: AttachmentRow | undefined };

/** Full-screen viewer: Esc closes, ←/→ navigate, +/−/0 or wheel/double-click zoom. */
export function ImageViewer({ items, openId, onClose }: { items: ViewerItem[]; openId: string | null; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [lastOpenId, setLastOpenId] = useState<string | null>(null);

  // Sync the shown index when a new image is opened (derived during render, not in an effect).
  if (openId !== lastOpenId) {
    setLastOpenId(openId);
    if (openId) {
      setIndex(
        Math.max(
          0,
          items.findIndex((i) => i.message.id === openId),
        ),
      );
      setZoom(1);
    }
  }

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => (items.length ? (i + delta + items.length) % items.length : 0));
      setZoom(1);
    },
    [items.length],
  );

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(4, z + 0.5));
      else if (e.key === "-") setZoom((z) => Math.max(1, z - 0.5));
      else if (e.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, go]);

  const item = items[index];

  return (
    <Dialog open={openId !== null && !!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="z-[70] flex h-dvh w-screen max-w-none flex-col gap-0 rounded-none border-0 bg-black/95 p-0 sm:max-w-none"
        data-testid="image-viewer"
      >
        <DialogTitle className="sr-only">Image viewer</DialogTitle>
        <DialogDescription className="sr-only">
          Use arrow keys to move between images and plus or minus to zoom.
        </DialogDescription>
        <div className="flex items-center gap-2 p-3 text-sm text-white/80">
          <span className="tabular-nums">
            {index + 1} / {items.length}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <ViewerButton label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>
              <Minus />
            </ViewerButton>
            <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <ViewerButton label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.5))}>
              <Plus />
            </ViewerButton>
            <ViewerButton label="Close" onClick={onClose}>
              <X />
            </ViewerButton>
          </span>
        </div>
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto"
          onWheel={(e) => setZoom((z) => Math.min(4, Math.max(1, z - e.deltaY * 0.002)))}
        >
          {item && <ViewerImage item={item} zoom={zoom} onToggleZoom={() => setZoom((z) => (z > 1 ? 1 : 2))} />}
          {items.length > 1 && (
            <>
              <ViewerButton label="Previous image" onClick={() => go(-1)} className="absolute top-1/2 left-3 -translate-y-1/2">
                <ChevronLeft />
              </ViewerButton>
              <ViewerButton label="Next image" onClick={() => go(1)} className="absolute top-1/2 right-3 -translate-y-1/2">
                <ChevronRight />
              </ViewerButton>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ViewerImage({ item, zoom, onToggleZoom }: { item: ViewerItem; zoom: number; onToggleZoom: () => void }) {
  const signed = useSignedUrl(item.message.kind === "image" ? item.attachment?.storage_path : null);
  const gif = item.message.kind === "gif" ? gifMetaSchema.safeParse(item.message.meta) : null;
  const src = gif?.success ? gif.data.url : (signed ?? item.message.localPreview ?? null);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={item.attachment?.file_name ?? (gif?.success ? gif.data.title : "") ?? "Image"}
      referrerPolicy="no-referrer"
      onDoubleClick={onToggleZoom}
      className="max-h-full max-w-full object-contain transition-transform duration-150 select-none"
      style={{ transform: `scale(${zoom})`, cursor: zoom > 1 ? "zoom-out" : "zoom-in" }}
      draggable={false}
      data-testid="viewer-image"
    />
  );
}

function ViewerButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`grid size-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 [&_svg]:size-5 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
