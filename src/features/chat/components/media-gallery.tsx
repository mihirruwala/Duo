"use client";

/* eslint-disable @next/next/no-img-element -- signed private / remote GIF URLs */
import { useEffect, useState } from "react";
import { Bookmark, Download, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getBrowserClient } from "@/lib/supabase/client";
import { gifMetaSchema, isStickerId, stickerMetaSchema } from "@/shared/chat";
import type { AttachmentRow, MessageRow } from "@/shared/database";
import { useChat } from "../chat-provider";
import type { ChatMessage } from "../chat-reducer";
import { downloadUrl, useSignedUrl } from "../signed-urls";
import { formatBytes } from "./message-content";
import type { ViewerItem } from "./image-viewer";

type GalleryData = { media: ViewerItem[]; files: AttachmentRow[] };

const asChat = (m: MessageRow): ChatMessage => ({ ...m, seq: Number(m.seq), status: "sent" });

/** Everything ever shared in this room (from the database, not just loaded history). */
export function MediaGallery({ roomId, onOpen }: { roomId: string; onOpen: (items: ViewerItem[], id: string) => void }) {
  const [data, setData] = useState<GalleryData | null>(null);
  const chat = useChat();
  // Refresh when new attachments arrive.
  const attachmentCount = Object.keys(chat.state.attachments).length;

  useEffect(() => {
    let alive = true;
    const sb = getBrowserClient();
    void (async () => {
      const [att, gifs] = await Promise.all([
        sb.from("attachments").select("*").eq("room_id", roomId).order("created_at", { ascending: false }).limit(200),
        sb
          .from("messages")
          .select("*")
          .eq("room_id", roomId)
          .eq("kind", "gif")
          .is("deleted_at", null)
          .order("seq", { ascending: false })
          .limit(200),
      ]);
      if (!alive || att.error || gifs.error) return;
      const imageAtts = att.data.filter((a) => a.mime_type.startsWith("image/") && a.message_id);
      const ids = imageAtts.map((a) => a.message_id!);
      const msgs = ids.length ? await sb.from("messages").select("*").in("id", ids) : { data: [] as MessageRow[], error: null };
      if (!alive || msgs.error) return;
      const byId = new Map(msgs.data.map((m) => [m.id, m]));
      const imageItems: ViewerItem[] = imageAtts.flatMap((a) => {
        const m = byId.get(a.message_id!);
        return m ? [{ message: asChat(m), attachment: a }] : [];
      });
      const gifItems: ViewerItem[] = gifs.data.map((m) => ({ message: asChat(m), attachment: undefined }));
      const media = [...imageItems, ...gifItems].sort((a, b) => b.message.seq - a.message.seq);
      setData({ media, files: att.data.filter((a) => !a.mime_type.startsWith("image/")) });
    })();
    return () => {
      alive = false;
    };
  }, [roomId, attachmentCount]);

  if (!data) {
    return (
      <div className="grid flex-1 place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading media" />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="media-gallery">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Photos & GIFs</h3>
      {data.media.length === 0 ? (
        <p className="mb-4 text-sm text-muted-foreground">Nothing shared yet.</p>
      ) : (
        <div className="mb-5 grid grid-cols-3 gap-1.5">
          {data.media.map((item) => (
            <Thumb key={item.message.id} item={item} onClick={() => onOpen(data.media, item.message.id)} />
          ))}
        </div>
      )}
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Files</h3>
      {data.files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {data.files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-xl bg-ink-1/60 p-2.5">
              <FileText className="size-5 shrink-0 text-violet" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{f.file_name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatBytes(f.size_bytes)} · {new Date(f.created_at).toLocaleDateString()}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Download ${f.file_name}`}
                className="grid size-8 place-items-center rounded-lg hover:bg-ink-3"
                onClick={async () => {
                  const url = await downloadUrl(f.storage_path, f.file_name);
                  if (!url) return toast.error("Couldn't get the file.");
                  const a = document.createElement("a");
                  a.href = url;
                  a.click();
                }}
              >
                <Download className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Thumb({ item, onClick }: { item: ViewerItem; onClick: () => void }) {
  const signed = useSignedUrl(item.message.kind === "image" ? item.attachment?.storage_path : null);
  const m = item.message;
  let src: string | null = null;
  let alt = "Shared image";
  if (m.kind === "gif") {
    const g = gifMetaSchema.safeParse(m.meta);
    src = g.success ? g.data.url : null;
    alt = g.success && g.data.title ? g.data.title : "GIF";
  } else if (m.kind === "sticker") {
    const s = stickerMetaSchema.safeParse(m.meta);
    src = s.success && isStickerId(s.data.sticker_id) ? `/stickers/${s.data.sticker_id}.svg` : null;
    alt = "Sticker";
  } else {
    src = signed;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="aspect-square overflow-hidden rounded-xl bg-ink-3 focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open ${alt}`}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={m.kind === "sticker" ? "h-full w-full object-contain p-2" : "h-full w-full object-cover"}
        />
      ) : (
        <span className="grid h-full place-items-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </span>
      )}
    </button>
  );
}

/** Shared collection: anything either person saved with the bookmark action. */
export function MomentsGrid({ onOpen }: { onOpen: (items: ViewerItem[], id: string) => void }) {
  const chat = useChat();
  const moments = Object.values(chat.state.moments).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const [extra, setExtra] = useState<{ messages: Record<string, MessageRow>; attachments: Record<string, AttachmentRow> }>({
    messages: {},
    attachments: {},
  });

  // Moments can point at old messages that aren't in the loaded history.
  const missing = moments.map((m) => m.message_id).filter((id) => !chat.state.messages[id] && !extra.messages[id]);
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missingKey) return;
    const ids = missingKey.split(",");
    let alive = true;
    const sb = getBrowserClient();
    void Promise.all([
      sb.from("messages").select("*").in("id", ids),
      sb.from("attachments").select("*").in("message_id", ids),
    ]).then(([m, a]) => {
      if (!alive || m.error || a.error) return;
      setExtra((prev) => ({
        messages: { ...prev.messages, ...Object.fromEntries(m.data.map((x) => [x.id, x])) },
        attachments: { ...prev.attachments, ...Object.fromEntries(a.data.map((x) => [x.message_id!, x])) },
      }));
    });
    return () => {
      alive = false;
    };
  }, [missingKey]);

  const items: ViewerItem[] = moments.flatMap((mo) => {
    const msg =
      chat.state.messages[mo.message_id] ?? (extra.messages[mo.message_id] ? asChat(extra.messages[mo.message_id]!) : undefined);
    if (!msg || msg.deleted_at) return [];
    return [{ message: msg, attachment: chat.state.attachments[mo.message_id] ?? extra.attachments[mo.message_id] }];
  });

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center" data-testid="moments-empty">
        <Bookmark className="size-8 text-sun" aria-hidden />
        <p className="font-bold">No Moments yet</p>
        <p className="text-sm text-muted-foreground">
          <span className="[@media(hover:none)]:hidden">Hover a photo, GIF or sticker in chat</span>
          <span className="[@media(hover:hover)]:hidden">Press and hold a photo, GIF or sticker in chat</span> and tap the
          bookmark to save it here, for both of you.
        </p>
      </div>
    );
  }
  const viewable = items.filter((i) => i.message.kind !== "sticker");
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="moments-grid">
      <div className="grid grid-cols-3 gap-1.5">
        {items.map((item) => (
          <div key={item.message.id} className="group/moment relative">
            <Thumb item={item} onClick={() => item.message.kind !== "sticker" && onOpen(viewable, item.message.id)} />
            <button
              type="button"
              onClick={() => void chat.toggleMoment(item.message.id).then((e) => e && toast.error(e))}
              aria-label="Remove from Moments"
              className="absolute top-1 right-1 grid size-7 place-items-center rounded-full bg-black/60 text-sun opacity-0 transition-opacity group-hover/moment:opacity-100 focus-visible:opacity-100"
            >
              <Bookmark className="size-3.5 fill-current" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
