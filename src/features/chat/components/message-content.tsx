"use client";

/* eslint-disable @next/next/no-img-element -- chat media are signed/remote URLs; next/image would proxy private files. */
import { Download, FileArchive, FileSpreadsheet, FileText, Loader2, Presentation } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { attachmentMetaSchema, gifMetaSchema, isStickerId, STICKERS, stickerMetaSchema } from "@/shared/chat";
import type { AttachmentRow } from "@/shared/database";
import type { ChatMessage } from "../chat-reducer";
import { Linkified } from "../linkify";
import { downloadUrl, useSignedUrl } from "../signed-urls";
import { VideoNote, VoiceNote } from "./note-content";

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Fit media into a max box while keeping aspect ratio (prevents layout jump while loading). */
function fit(w: number | null | undefined, h: number | null | undefined, max = 260) {
  if (!w || !h) return { width: max, height: Math.round(max * 0.66) };
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export function MessageContent({
  message,
  attachment,
  onOpenImage,
}: {
  message: ChatMessage;
  attachment: AttachmentRow | undefined;
  onOpenImage: (id: string) => void;
}) {
  if (message.deleted_at) {
    return <p className="text-sm text-muted-foreground italic">This message was deleted</p>;
  }

  switch (message.kind) {
    case "text":
      return (
        <p className="text-[0.95rem] leading-relaxed break-words whitespace-pre-wrap">
          <Linkified text={message.body ?? ""} />
        </p>
      );
    case "gif": {
      const meta = gifMetaSchema.safeParse(message.meta);
      if (!meta.success) return <p className="text-sm text-muted-foreground">GIF unavailable</p>;
      const size = fit(meta.data.width, meta.data.height);
      return (
        <button
          type="button"
          onClick={() => onOpenImage(message.id)}
          className="block overflow-hidden rounded-2xl"
          aria-label={`Open GIF: ${meta.data.title || "GIF"}`}
        >
          <img
            src={meta.data.url}
            alt={meta.data.title || "GIF"}
            width={size.width}
            height={size.height}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="block bg-ink-1 object-cover"
            style={size}
          />
        </button>
      );
    }
    case "sticker": {
      const meta = stickerMetaSchema.safeParse(message.meta);
      const id = meta.success && isStickerId(meta.data.sticker_id) ? meta.data.sticker_id : null;
      if (!id) return <p className="text-sm text-muted-foreground">Sticker unavailable</p>;
      const label = STICKERS.find((s) => s.id === id)?.label ?? "Sticker";
      return (
        <img
          src={`/stickers/${id}.svg`}
          alt={label}
          width={128}
          height={128}
          className="size-32 drop-shadow-lg"
          draggable={false}
        />
      );
    }
    case "image":
      return <ImageContent message={message} attachment={attachment} onOpen={() => onOpenImage(message.id)} />;
    case "file":
      return <FileContent message={message} attachment={attachment} />;
    case "voice":
      return <VoiceNote message={message} attachment={attachment} />;
    case "video":
      return <VideoNote message={message} attachment={attachment} />;
  }
}

function ImageContent({
  message,
  attachment,
  onOpen,
}: {
  message: ChatMessage;
  attachment: AttachmentRow | undefined;
  onOpen: () => void;
}) {
  const signed = useSignedUrl(attachment?.storage_path);
  const meta = attachmentMetaSchema.safeParse(message.meta);
  const src = signed ?? message.localPreview ?? null;
  const size = fit(
    attachment?.width ?? (meta.success ? meta.data.width : null),
    attachment?.height ?? (meta.success ? meta.data.height : null),
  );
  const uploading = message.status === "sending";

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!src || uploading}
      className="relative block overflow-hidden rounded-2xl bg-ink-1"
      style={size}
      aria-label="Open image"
    >
      {src ? (
        <img
          src={src}
          alt={attachment?.file_name ?? "Image"}
          className={cn("h-full w-full object-cover", uploading && "opacity-60")}
          data-testid="chat-image"
        />
      ) : (
        <span className="grid h-full w-full place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </span>
      )}
      {uploading && <UploadProgress progress={message.progress ?? 0} />}
    </button>
  );
}

const FILE_ICONS: Record<string, typeof FileText> = {
  "application/zip": FileArchive,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": FileSpreadsheet,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": Presentation,
};

function FileContent({ message, attachment }: { message: ChatMessage; attachment: AttachmentRow | undefined }) {
  const meta = attachmentMetaSchema.safeParse(message.meta);
  const name = attachment?.file_name ?? (meta.success ? meta.data.file_name : "File");
  const size = attachment?.size_bytes ?? (meta.success ? meta.data.size_bytes : 0);
  const mime = attachment?.mime_type ?? (meta.success ? meta.data.mime_type : "");
  const Icon = FILE_ICONS[mime] ?? FileText;
  const [busy, setBusy] = useState(false);
  const uploading = message.status === "sending";

  async function download() {
    if (!attachment) return;
    setBusy(true);
    const url = await downloadUrl(attachment.storage_path, attachment.file_name);
    setBusy(false);
    if (!url) return toast.error("Couldn't get the file. Try again.");
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    a.click();
  }

  return (
    <div className="flex w-64 max-w-full items-center gap-3 rounded-2xl bg-ink-1/70 p-3" data-testid="chat-file">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink-3 text-violet">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold" title={name}>
          {name}
        </span>
        <span className="block text-xs text-muted-foreground">
          {uploading ? `Uploading… ${Math.round((message.progress ?? 0) * 100)}%` : formatBytes(size)}
        </span>
        {uploading && (
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-ink-3">
            <span
              className="block h-full bg-coral transition-[width]"
              style={{ width: `${Math.round((message.progress ?? 0) * 100)}%` }}
            />
          </span>
        )}
      </span>
      {!uploading && attachment && (
        <button
          type="button"
          onClick={download}
          disabled={busy}
          aria-label={`Download ${name}`}
          className="grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-ink-3 hover:text-foreground"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        </button>
      )}
    </div>
  );
}

function UploadProgress({ progress }: { progress: number }) {
  const pct = Math.round(progress * 100);
  return (
    <span
      className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Upload progress"
    >
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
        <span className="block h-full bg-coral transition-[width]" style={{ width: `${pct}%` }} />
      </span>
      {pct}%
    </span>
  );
}
