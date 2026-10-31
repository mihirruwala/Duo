"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useChat } from "../chat-provider";
import type { ChatMessage } from "../chat-reducer";
import { MessageItem } from "./message-item";

const GROUP_GAP_MS = 5 * 60 * 1000;

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function MessageList({
  active,
  onReply,
  onOpenImage,
}: {
  /** Panel is open and this tab is showing: counts as "reading". */
  active: boolean;
  onReply: (id: string) => void;
  onOpenImage: (id: string) => void;
}) {
  const chat = useChat();
  const { messages, state, me, people } = chat;
  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const prevHeight = useRef<number | null>(null);
  const lastCount = useRef(0);

  // Am I reading? (open, visible, scrolled to the bottom)
  useEffect(() => {
    const update = () => chat.setViewing(active && atBottom && document.visibilityState === "visible" && document.hasFocus());
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      chat.setViewing(false);
    };
  }, [active, atBottom, chat.setViewing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whether we were pinned to the bottom as of the last user scroll.
  const pinned = useRef(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    pinned.current = bottom;
    setAtBottom(bottom);
  }, []);

  // Content can grow without new messages (images/GIFs finishing loading). Stay pinned.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [state.loaded]);

  // Keep pinned to the bottom for new messages; keep position stable when older ones are prepended.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (messages.length !== lastCount.current) {
      const newest = messages[messages.length - 1];
      if (pinned.current || newest?.sender_id === me.id) {
        el.scrollTop = el.scrollHeight;
        pinned.current = true;
      }
    }
    lastCount.current = messages.length;
  }, [messages, atBottom, me.id]);

  // Infinite scroll upwards.
  useEffect(() => {
    const el = topRef.current;
    if (!el || !state.hasMoreOlder) return;
    const io = new IntersectionObserver(
      async ([entry]) => {
        if (!entry?.isIntersecting || loadingOlder) return;
        setLoadingOlder(true);
        prevHeight.current = scrollRef.current?.scrollHeight ?? null;
        await chat.loadOlder();
        setLoadingOlder(false);
      },
      { root: scrollRef.current, rootMargin: "200px 0px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [state.hasMoreOlder, loadingOlder, chat.loadOlder]); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = useCallback(
    async (id: string) => {
      const ok = await chat.ensureLoaded(id);
      if (!ok) return toast.error("That message is no longer available.");
      requestAnimationFrame(() => {
        document.getElementById(`msg-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
        setHighlight(id);
        setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1800);
      });
    },
    [chat.ensureLoaded], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // "Sent / Delivered / Read" under my latest confirmed message.
  const lastMine = [...messages].reverse().find((m) => m.sender_id === me.id && m.status === "sent" && !m.deleted_at);
  const receiptFor = (m: ChatMessage) => {
    if (m.id !== lastMine?.id) return null;
    const r = chat.partnerReceipt;
    if (r && Number(r.read_seq) >= m.seq) return "Read";
    if (r && Number(r.delivered_seq) >= m.seq) return "Delivered";
    return "Sent";
  };

  if (!state.loaded) {
    return (
      <div className="grid flex-1 place-items-center" role="status">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading messages" />
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain pb-2"
        data-testid="message-scroll"
      >
        <div ref={contentRef}>
          <div ref={topRef} />
          {state.hasMoreOlder && (
            <div className="grid place-items-center py-2">
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading older messages" />
            </div>
          )}
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="text-4xl" aria-hidden>
                💬
              </span>
              <p className="font-bold">No messages yet</p>
              <p className="text-sm text-muted-foreground">
                Say hi, drop a sticker, or share a photo. It all stays right here for next time.
              </p>
            </div>
          ) : (
            <ol aria-label="Messages" aria-live="polite" aria-relevant="additions">
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
                const startsGroup =
                  newDay ||
                  !prev ||
                  prev.sender_id !== m.sender_id ||
                  Date.parse(m.created_at) - Date.parse(prev.created_at) > GROUP_GAP_MS;
                return (
                  <DayAndMessage key={m.id} newDay={newDay} label={dayLabel(m.created_at)}>
                    <MessageItem
                      message={m}
                      replyTo={m.reply_to ? state.messages[m.reply_to] : undefined}
                      attachment={state.attachments[m.id]}
                      reactions={state.reactions[m.id]}
                      saved={!!state.moments[m.id]}
                      sender={people[m.sender_id]}
                      myId={me.id}
                      people={people}
                      startsGroup={startsGroup}
                      status={receiptFor(m)}
                      highlighted={highlight === m.id}
                      onReply={onReply}
                      onJump={jump}
                      onOpenImage={onOpenImage}
                      onReact={(id, e) => void chat.toggleReaction(id, e).then((err) => err && toast.error(err))}
                      onEdit={chat.edit}
                      onDelete={chat.remove}
                      onToggleMoment={(id) => void chat.toggleMoment(id).then((err) => err && toast.error(err))}
                      onRetry={chat.retry}
                    />
                  </DayAndMessage>
                );
              })}
            </ol>
          )}
          {chat.partnerTyping && (
            <p
              className="flex items-center gap-2 px-4 pt-2 text-xs text-muted-foreground"
              role="status"
              data-testid="typing-indicator"
            >
              <span className="flex gap-0.5" aria-hidden>
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:120ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:240ms]" />
              </span>
              {chat.partner?.name ?? "They"} is typing…
            </p>
          )}
        </div>
      </div>

      {!atBottom && (
        <button
          type="button"
          onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })}
          className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full bg-coral px-3 py-1.5 text-xs font-bold text-ink-0 shadow-lg"
        >
          <ArrowDown className="size-3.5" /> {chat.unread > 0 ? `${chat.unread} new` : "Latest"}
        </button>
      )}
    </div>
  );
}

function DayAndMessage({ newDay, label, children }: { newDay: boolean; label: string; children: React.ReactNode }) {
  return (
    <>
      {newDay && (
        <li
          className="my-3 flex items-center gap-3 px-4 text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase"
          aria-hidden
        >
          <span className="h-px flex-1 bg-border" />
          {label}
          <span className="h-px flex-1 bg-border" />
        </li>
      )}
      {children}
    </>
  );
}
