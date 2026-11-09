"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bookmark,
  ChevronLeft,
  Images,
  ListChecks,
  MessageCircle,
  Minus,
  MoveDiagonal2,
  PhoneCall,
  Upload,
  Video,
  X,
} from "lucide-react";
import { usePhone } from "@/lib/use-phone";
import { setPhoneSheet } from "@/features/rooms/phone-room-store";
import { ListsPanel } from "@/features/lists/components/lists-panel";
import { useCallOpen } from "@/features/call/watch/watch-events";
import { DOCKED_WIDTH, PREF_KEY, restoreDock, setDockOpen, useDock } from "../dock-store";
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
function saveSize(size: Size) {
  try {
    const prev = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Record<string, unknown>;
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...prev, size }));
  } catch {
    // Storage unavailable; the dock just won't remember its size.
  }
}

/**
 * The chat. Outside a call it floats (resizable, collapsible) with its own launcher. During a call it
 * docks beside the video on wide screens (the call makes room for it) and is opened from the call's
 * control bar, so it never covers your person.
 */
export function ChatDock({ roomId, roomName, gifsEnabled }: { roomId: string; roomName: string; gifsEnabled: boolean }) {
  const chat = useChat();
  // Phones, outside a call: the chat *is* the room screen (always open, with the room's top bar).
  const phone = usePhone();
  // Until saved prefs are restored we render nothing, so a dock that was open doesn't flash closed.
  const { open, restored } = useDock();
  const inCall = useCallOpen();
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
      setSize(p.size);
      restoreDock();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const setOpenPersist = setDockOpen;

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
        saveSize(s);
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
      saveSize(next);
      return next;
    });
  }

  const roomScreen = phone === true && !inCall;
  // The phone room screen doesn't depend on saved prefs, so it renders in the same commit as the
  // navigation and slides in with the page.
  if (!roomScreen && (!restored || phone === null)) return null;

  if (!open && !roomScreen) {
    // In a call the control bar has the Chat button (with the unread count); no floating pill over the video.
    if (inCall) return null;
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
        data-docked={inCall ? "" : undefined}
        data-room-screen={roomScreen ? "" : undefined}
        className={cn(
          roomScreen && "!z-40 !bg-background !backdrop-blur-none",
          "glass fixed inset-0 z-50 flex flex-col overflow-hidden shadow-2xl sm:inset-auto sm:right-4 sm:bottom-4 sm:max-h-[calc(100dvh-2rem)] sm:max-w-[calc(100vw-2rem)] sm:rounded-[1.75rem] sm:[height:var(--dock-h)] sm:[width:var(--dock-w)]",
          // Docked beside the call on wide screens: full height, fixed width, flush to the edge.
          // Mid-size screens: float, but end above the call's control bar.
          inCall && "sm:bottom-24 sm:max-h-[calc(100dvh-7.5rem)]",
          inCall &&
            "lg:top-0 lg:right-0 lg:bottom-0 lg:max-h-none lg:rounded-none lg:border-y-0 lg:border-r-0 lg:bg-ink-1 lg:shadow-none lg:backdrop-blur-none lg:[height:100dvh] lg:[width:var(--dock-docked)]",
        )}
        style={
          {
            "--dock-w": `${size.width}px`,
            "--dock-h": `${size.height}px`,
            "--dock-docked": `${DOCKED_WIDTH}px`,
          } as React.CSSProperties
        }
      >
        <button
          type="button"
          onPointerDown={startResize}
          onKeyDown={onResizeKey}
          aria-label="Resize chat (arrow keys)"
          className={cn(
            "absolute top-1.5 left-1.5 z-10 hidden size-6 cursor-nwse-resize place-items-center rounded-md text-muted-foreground hover:bg-ink-3 sm:grid",
            inCall && "lg:hidden",
          )}
        >
          <MoveDiagonal2 className="size-3.5" />
        </button>

        {roomScreen ? (
          <PhoneRoomBar roomName={roomName} />
        ) : (
          <header
            className={cn(
              "flex items-center gap-2 border-b border-border px-4 pt-3 pb-2 max-sm:pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:pl-9",
              inCall && "lg:pl-4",
            )}
          >
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
              aria-label={inCall ? "Close chat" : "Minimize chat"}
              data-testid="chat-minimize"
              className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-ink-3 hover:text-foreground"
            >
              {inCall ? <X className="size-4" /> : <Minus className="size-4" />}
            </button>
          </header>
        )}

        <div
          role="tablist"
          aria-label="Chat sections"
          className={cn(
            "flex gap-0.5 overflow-x-auto border-b border-border px-2 py-1.5",
            // Phones: an iOS-style segmented control.
            "max-sm:mx-3 max-sm:my-2 max-sm:grid max-sm:grid-cols-4 max-sm:rounded-xl max-sm:border-0 max-sm:bg-ink-1 max-sm:p-0.5",
          )}
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
                "max-sm:justify-center max-sm:rounded-[0.6rem] max-sm:px-1 max-sm:text-[13px]",
                tab === id ? "bg-ink-3 text-foreground max-sm:shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4 max-sm:hidden" /> {label}
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

/** Phone room screen's top bar: back, who you're with (tap for room info), and the call button. */
function PhoneRoomBar({ roomName }: { roomName: string }) {
  const chat = useChat();
  const p = chat.partnerPresence;
  const status = !chat.connected
    ? "Connecting…"
    : chat.partnerTyping
      ? "typing…"
      : p.inCall
        ? "In a call"
        : p.where === "room"
          ? "Here in the room"
          : p.online
            ? "Online"
            : chat.partner
              ? "Away"
              : "Waiting for your person to join";
  return (
    <header className="flex items-center gap-1 border-b border-border/60 bg-ink-1/80 px-1.5 pt-[calc(env(safe-area-inset-top)+0.375rem)] pb-1.5 backdrop-blur-xl">
      <Link
        href="/home"
        transitionTypes={["nav-back"]}
        aria-label="All rooms"
        className="grid size-11 shrink-0 place-items-center text-coral"
      >
        <ChevronLeft className="size-7" strokeWidth={2.4} />
      </Link>
      <button
        type="button"
        onClick={() => setPhoneSheet("info")}
        aria-label="Room info"
        data-testid="room-info-button"
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1 text-left active:bg-ink-3/50"
      >
        {chat.partner && (
          <span className="relative shrink-0">
            <DuoAvatar name={chat.partner.name} hue={chat.partner.hue} size="sm" />
            <span
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-ink-1",
                p.inCall ? "bg-coral" : chat.partnerOnline ? "bg-mint" : "bg-ink-4",
              )}
              role="img"
              aria-label={chat.partnerOnline ? "Online" : "Offline"}
              data-testid="presence"
              data-online={chat.partnerOnline ? "" : undefined}
            />
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-[17px] leading-tight font-bold">{chat.partner?.name ?? roomName}</span>
          <span className={cn("block truncate text-xs", p.inCall ? "font-semibold text-coral" : "text-muted-foreground")}>
            {chat.partner ? `${roomName} · ${status}` : status}
          </span>
        </span>
      </button>
      {p.inCall ? (
        <button
          type="button"
          onClick={() => setPhoneSheet("call")}
          data-testid="phone-call-button"
          className="mr-1.5 flex shrink-0 items-center gap-1.5 rounded-full bg-mint px-3.5 py-2 text-sm font-bold text-ink-0 active:scale-95"
        >
          <PhoneCall className="size-4" /> Join
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setPhoneSheet("call")}
          aria-label="Start a video call"
          data-testid="phone-call-button"
          className="grid size-11 shrink-0 place-items-center text-coral active:scale-95"
        >
          <Video className="size-6" />
        </button>
      )}
    </header>
  );
}
