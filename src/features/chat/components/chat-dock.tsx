"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Images, ListChecks, MessageCircle, Minus, MoveDiagonal2, Upload } from "lucide-react";
import { ListsPanel } from "@/features/lists/components/lists-panel";
import { toast } from "sonner";
import { DuoAvatar } from "@/components/duo/avatar";
import { cn } from "@/lib/utils";
import { useChat } from "../chat-provider";
import { Composer } from "./composer";
import { ImageViewer, type ViewerItem } from "./image-viewer";
import { MediaGallery, MomentsGrid } from "./media-gallery";
import { MessageList } from "./message-list";

type Tab = "chat" | "media" | "moments" | "lists";
type Size = { width: number; height: number };

const PREF_KEY = "duo.chatDock.v1";
const MIN: Size = { width: 320, height: 380 };
const DEFAULT: Size = { width: 380, height: 560 };

function loadPrefs(): { open: boolean; size: Size } {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Partial<{ open: boolean; size: Size }>;
    return { open: p.open ?? false, size: p.size?.width && p.size.height ? p.size : DEFAULT };
  } catch {
    return { open: false, size: DEFAULT };
  }
}
function savePrefs(p: { open: boolean; size: Size }) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable; the dock just won't remember its size.
  }
}

/** Floating, resizable, collapsible chat that sits above the call. */
export function ChatDock({ roomId, gifsEnabled }: { roomId: string; gifsEnabled: boolean }) {
  const chat = useChat();
  const [open, setOpen] = useState(false);
  // Until saved prefs are restored we render nothing, so a dock that was open doesn't flash closed.
  const [restored, setRestored] = useState(false);
  const [size, setSize] = useState<Size>(DEFAULT);
  const [tab, setTab] = useState<Tab>("chat");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; id: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Restore after mount (keeps SSR markup stable).
  useEffect(() => {
    const p = loadPrefs();
    const t = setTimeout(() => {
      setOpen(p.open);
      setSize(p.size);
      setRestored(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const setOpenPersist = (o: boolean) => {
    setOpen(o);
    savePrefs({ open: o, size });
  };

  // Viewer list: all images + GIFs in loaded history, in order.
  const chatMedia = useMemo<ViewerItem[]>(
    () =>
      chat.messages
        .filter((m) => (m.kind === "image" || m.kind === "gif") && !m.deleted_at)
        .map((m) => ({ message: m, attachment: chat.state.attachments[m.id] })),
    [chat.messages, chat.state.attachments],
  );

  const openFromChat = useCallback((id: string) => setViewer({ items: chatMedia, id }), [chatMedia]);

  // Resize from the top-left corner (the panel is anchored bottom-right).
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, ...size };
    const move = (ev: PointerEvent) => {
      const width = Math.min(window.innerWidth - 32, Math.max(MIN.width, start.width - (ev.clientX - start.x)));
      const height = Math.min(window.innerHeight - 32, Math.max(MIN.height, start.height - (ev.clientY - start.y)));
      setSize({ width, height });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSize((s) => {
        savePrefs({ open: true, size: s });
        return s;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onResizeKey(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 60 : 20;
    const delta = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    setSize((s) => {
      const next = {
        width: Math.min(window.innerWidth - 32, Math.max(MIN.width, s.width + delta[0]!)),
        height: Math.min(window.innerHeight - 32, Math.max(MIN.height, s.height + delta[1]!)),
      };
      savePrefs({ open: true, size: next });
      return next;
    });
  }

  if (!restored) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpenPersist(true)}
        data-testid="chat-launcher"
        aria-label={chat.unread ? `Open chat, ${chat.unread} unread` : "Open chat"}
        className="fixed right-4 bottom-24 z-50 flex items-center gap-2 rounded-full bg-cream py-3 pr-5 pl-4 font-bold text-ink-0 shadow-2xl transition-transform hover:scale-105 sm:bottom-6"
      >
        <MessageCircle className="size-5" /> Chat
        {chat.unread > 0 && (
          <span
            className="grid min-w-6 place-items-center rounded-full bg-coral px-1.5 text-xs text-ink-0"
            data-testid="unread-badge"
          >
            {chat.unread > 99 ? "99+" : chat.unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <>
      <section
        ref={panelRef}
        aria-label="Chat"
        data-testid="chat-panel"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (!panelRef.current?.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length) {
            const problem = chat.sendFiles(files, replyTo);
            if (problem) toast.error(problem);
            setTab("chat");
          }
        }}
        className="glass fixed inset-0 z-50 flex flex-col overflow-hidden shadow-2xl sm:inset-auto sm:right-4 sm:bottom-4 sm:max-h-[calc(100dvh-2rem)] sm:max-w-[calc(100vw-2rem)] sm:rounded-[1.75rem] sm:[height:var(--dock-h)] sm:[width:var(--dock-w)]"
        style={{ "--dock-w": `${size.width}px`, "--dock-h": `${size.height}px` } as React.CSSProperties}
      >
        <button
          type="button"
          onPointerDown={startResize}
          onKeyDown={onResizeKey}
          aria-label="Resize chat (arrow keys)"
          className="absolute top-1.5 left-1.5 z-10 hidden size-6 cursor-nwse-resize place-items-center rounded-md text-muted-foreground hover:bg-ink-3 sm:grid"
        >
          <MoveDiagonal2 className="size-3.5" />
        </button>

        <header className="flex items-center gap-2 border-b border-border px-4 pt-3 pb-2 sm:pl-9">
          {chat.partner ? (
            <span className="relative">
              <DuoAvatar name={chat.partner.name} hue={chat.partner.hue} size="sm" />
              <span
                className={cn(
                  "absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-ink-2",
                  chat.partnerOnline ? "bg-mint" : "bg-ink-4",
                )}
                role="img"
                aria-label={chat.partnerOnline ? "Online" : "Offline"}
                data-testid="presence"
                data-online={chat.partnerOnline ? "" : undefined}
              />
            </span>
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold">{chat.partner?.name ?? "Chat"}</span>
            <span className="block text-xs text-muted-foreground">
              {!chat.connected ? "Connecting…" : chat.partnerTyping ? "typing…" : chat.partnerOnline ? "Online" : "Away"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setOpenPersist(false)}
            aria-label="Minimize chat"
            data-testid="chat-minimize"
            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-ink-3 hover:text-foreground"
          >
            <Minus className="size-4" />
          </button>
        </header>

        <div
          role="tablist"
          aria-label="Chat sections"
          className="flex gap-0.5 overflow-x-auto border-b border-border px-2 py-1.5"
        >
          {(
            [
              ["chat", "Chat", MessageCircle],
              ["media", "Media", Images],
              ["moments", "Moments", Bookmark],
              ["lists", "Lists", ListChecks],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-colors",
                tab === id ? "bg-ink-3 text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>

        {tab === "chat" && (
          <>
            <MessageList active={tab === "chat"} onReply={setReplyTo} onOpenImage={openFromChat} />
            <Composer replyTo={replyTo} onCancelReply={() => setReplyTo(null)} gifsEnabled={gifsEnabled} />
          </>
        )}
        {tab === "media" && <MediaGallery roomId={roomId} onOpen={(items, id) => setViewer({ items, id })} />}
        {tab === "moments" && <MomentsGrid onOpen={(items, id) => setViewer({ items, id })} />}
        {tab === "lists" && <ListsPanel />}

        {dragging && (
          <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-3xl border-2 border-dashed border-coral bg-ink-1/80 text-coral">
            <span className="flex flex-col items-center gap-2 font-bold">
              <Upload className="size-8" /> Drop to send
            </span>
          </div>
        )}
      </section>
      <ImageViewer items={viewer?.items ?? []} openId={viewer?.id ?? null} onClose={() => setViewer(null)} />
    </>
  );
}
