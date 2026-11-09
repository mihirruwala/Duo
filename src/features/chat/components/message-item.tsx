"use client";

import { memo, useEffect, useRef, useState } from "react";
import { AlertCircle, Bookmark, BookmarkCheck, Copy, CornerUpLeft, Pencil, SmilePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDuration, MAX_MESSAGE_LENGTH } from "@/shared/chat";
import type { AttachmentRow, ReactionRow } from "@/shared/database";
import { summarizeReactions, type ChatMessage } from "../chat-reducer";
import type { Person } from "../chat-provider";
import { MessageContent } from "./message-content";
import { ReactionPicker } from "./reaction-picker";

export type MessageItemProps = {
  message: ChatMessage;
  replyTo: ChatMessage | undefined;
  attachment: AttachmentRow | undefined;
  reactions: ReactionRow[] | undefined;
  saved: boolean;
  sender: Person | undefined;
  myId: string;
  people: Record<string, Person>;
  /** First message in a run from the same sender (shows name + spacing). */
  startsGroup: boolean;
  /** "Sent" / "Delivered" / "Read" for my latest message, else null. */
  status: string | null;
  highlighted: boolean;
  onReply: (id: string) => void;
  onJump: (id: string) => void;
  onOpenImage: (id: string) => void;
  onReact: (id: string, emoji: string) => void;
  onEdit: (id: string, body: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onToggleMoment: (id: string) => void;
  onRetry: (id: string) => void;
};

function time(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function replySnippet(m: ChatMessage | undefined): string {
  if (!m) return "Original message";
  if (m.deleted_at) return "Deleted message";
  switch (m.kind) {
    case "text":
      return m.body ?? "";
    case "image":
      return "📷 Photo";
    case "gif":
      return "GIF";
    case "sticker":
      return "Sticker";
    case "file":
      return `📎 ${(m.meta as { file_name?: string }).file_name ?? "File"}`;
    case "voice":
    case "video": {
      const ms = (m.meta as { duration_ms?: number }).duration_ms;
      return `${m.kind === "voice" ? "🎤 Voice message" : "📹 Video message"}${ms ? ` (${formatDuration(ms)})` : ""}`;
    }
  }
}

export const MessageItem = memo(function MessageItem(props: MessageItemProps) {
  const { message: m, myId, sender, startsGroup } = props;
  const mine = m.sender_id === myId;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const deleted = !!m.deleted_at;
  const media = m.kind === "gif" || m.kind === "sticker" || m.kind === "image";
  const bare = m.kind === "sticker" || m.kind === "video" || ((m.kind === "gif" || m.kind === "image") && !m.body);
  const reactions = summarizeReactions(props.reactions, myId);
  const confirmed = m.status === "sent";
  // Touch screens: actions come up on a long-press (like Messages), not on a tap.
  const [held, setHeld] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemRef = useRef<HTMLLIElement>(null);
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const onPressStart = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch" || deleted || editing || !confirmed) return;
    cancelPress();
    pressTimer.current = setTimeout(() => {
      setHeld(true);
      navigator.vibrate?.(10);
    }, 450);
  };
  useEffect(() => {
    if (!held) return;
    const close = (e: PointerEvent) => {
      if (!itemRef.current?.querySelector('[role="toolbar"]')?.contains(e.target as Node)) setHeld(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [held]);
  useEffect(() => cancelPress, []);

  async function saveEdit() {
    if (draft.trim() === (m.body ?? "").trim()) return setEditing(false);
    const err = await props.onEdit(m.id, draft);
    if (err) toast.error(err);
    else setEditing(false);
  }

  return (
    <li
      ref={itemRef}
      id={`msg-${m.id}`}
      data-testid="chat-message"
      data-mine={mine ? "" : undefined}
      data-status={m.status}
      className={cn(
        "group/msg relative flex flex-col px-3 transition-colors duration-700",
        mine ? "items-end" : "items-start",
        startsGroup ? "mt-3" : "mt-0.5",
        props.highlighted && "bg-coral/10",
      )}
    >
      {startsGroup && !mine && (
        <span className="mb-1 ml-1 text-xs font-semibold text-muted-foreground">{sender?.name ?? "Someone"}</span>
      )}

      <div className={cn("relative flex max-w-[85%] items-end gap-1", mine && "flex-row-reverse")}>
        <div
          tabIndex={0}
          aria-label={`${mine ? "You" : (sender?.name ?? "Someone")}: ${replySnippet(m)}`}
          onPointerDown={onPressStart}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onPointerMove={(e) => e.pointerType === "touch" && Math.abs(e.movementY) > 2 && cancelPress()}
          onContextMenu={(e) => {
            // The long-press is ours on touch screens; no system menu on top of it.
            if (window.matchMedia("(hover: none)").matches) e.preventDefault();
          }}
          className={cn(
            "relative min-w-0 rounded-3xl outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring",
            "[@media(hover:none)]:[-webkit-touch-callout:none] [@media(hover:none)]:select-none",
            held && "scale-[1.03]",
            !bare && "px-3.5 py-2",
            !bare && (mine ? "rounded-br-lg bg-coral/18 text-cream" : "rounded-bl-lg bg-ink-3"),
            deleted && "bg-transparent px-1 py-0",
            m.status === "failed" && "ring-1 ring-destructive/60",
          )}
        >
          {m.reply_to && !deleted && (
            <button
              type="button"
              onClick={() => props.onJump(m.reply_to!)}
              className={cn(
                "mb-1.5 flex w-full max-w-64 flex-col rounded-xl border-l-3 border-violet bg-black/20 px-2.5 py-1 text-left text-xs",
                bare && "mb-1",
              )}
              data-testid="reply-quote"
            >
              <span className="font-semibold text-violet">
                {props.replyTo ? (props.people[props.replyTo.sender_id]?.name ?? "Someone") : "Reply"}
              </span>
              <span className="truncate text-muted-foreground">{replySnippet(props.replyTo)}</span>
            </button>
          )}

          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveEdit();
              }}
              className="flex w-72 max-w-full flex-col gap-1.5"
            >
              <textarea
                autoFocus
                value={draft}
                maxLength={MAX_MESSAGE_LENGTH}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditing(false);
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void saveEdit();
                  }
                }}
                aria-label="Edit message"
                rows={Math.min(6, draft.split("\n").length + 1)}
                className="w-full resize-none rounded-xl bg-ink-1/80 px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="flex justify-end gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-lg px-2 py-1 text-muted-foreground hover:bg-ink-3"
                >
                  Cancel <kbd className="opacity-60">esc</kbd>
                </button>
                <button type="submit" className="rounded-lg bg-coral px-2 py-1 font-semibold text-ink-0">
                  Save <kbd className="opacity-60">↵</kbd>
                </button>
              </span>
            </form>
          ) : (
            <MessageContent message={m} attachment={props.attachment} onOpenImage={props.onOpenImage} />
          )}

          {m.body && m.kind !== "text" && !deleted && <p className="mt-1.5 px-1 text-sm whitespace-pre-wrap">{m.body}</p>}
        </div>

        {/* Hover / focus actions */}
        {!deleted && !editing && confirmed && (
          <div
            className={cn(
              "absolute -top-4 z-10 flex items-center gap-0.5 rounded-xl border border-border bg-popover p-0.5 opacity-0 shadow-lg transition-opacity group-focus-within/msg:opacity-100 group-hover/msg:opacity-100",
              // Touch: only after a long-press, a little higher so the finger doesn't cover it.
              "[@media(hover:none)]:pointer-events-none [@media(hover:none)]:-top-12 [@media(hover:none)]:!opacity-0 [@media(hover:none)]:rounded-2xl",
              mine ? "right-2" : "left-2",
              (pickerOpen || confirmDelete) && "opacity-100",
              (held || pickerOpen || confirmDelete) &&
                "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:!opacity-100",
            )}
            role="toolbar"
            aria-label="Message actions"
          >
            <Action
              label="Reply"
              onClick={() => {
                setHeld(false);
                props.onReply(m.id);
              }}
            >
              <CornerUpLeft />
            </Action>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger
                    className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-ink-3 hover:text-foreground"
                    aria-label="React"
                  >
                    <SmilePlus className="size-4" />
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>React</TooltipContent>
              </Tooltip>
              <PopoverContent className="w-auto rounded-2xl p-2" side="top">
                <ReactionPicker
                  onPick={(e) => {
                    props.onReact(m.id, e);
                    setPickerOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
            {m.kind === "text" && (
              <Action
                label="Copy"
                onClick={() =>
                  void navigator.clipboard.writeText(m.body ?? "").then(
                    () => toast.success("Copied"),
                    () => toast.error("Couldn't copy"),
                  )
                }
              >
                <Copy />
              </Action>
            )}
            {media && (
              <Action label={props.saved ? "Remove from Moments" : "Save to Moments"} onClick={() => props.onToggleMoment(m.id)}>
                {props.saved ? <BookmarkCheck className="text-sun" /> : <Bookmark />}
              </Action>
            )}
            {mine && m.kind === "text" && (
              <Action
                label="Edit"
                onClick={() => {
                  setDraft(m.body ?? "");
                  setEditing(true);
                }}
              >
                <Pencil />
              </Action>
            )}
            {mine &&
              (confirmDelete ? (
                <button
                  type="button"
                  onClick={async () => {
                    const err = await props.onDelete(m.id);
                    if (err) toast.error(err);
                    setConfirmDelete(false);
                  }}
                  onBlur={() => setConfirmDelete(false)}
                  autoFocus
                  className="rounded-lg bg-danger px-2 py-1 text-xs font-bold text-ink-0"
                >
                  Delete?
                </button>
              ) : (
                <Action label="Delete" onClick={() => setConfirmDelete(true)}>
                  <Trash2 />
                </Action>
              ))}
          </div>
        )}
      </div>

      {reactions.length > 0 && !deleted && (
        <ul className={cn("mt-1 flex flex-wrap gap-1", mine ? "justify-end" : "justify-start")} aria-label="Reactions">
          {reactions.map((r) => (
            <li key={r.emoji}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => props.onReact(m.id, r.emoji)}
                    aria-pressed={r.mine}
                    aria-label={`${r.emoji} ${r.count}, ${r.mine ? "remove your reaction" : "add yours"}`}
                    data-testid="reaction-chip"
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm transition-colors",
                      r.mine ? "border-coral/60 bg-coral/15" : "border-border bg-ink-2 hover:bg-ink-3",
                    )}
                  >
                    <span>{r.emoji}</span>
                    <span className="text-xs font-semibold tabular-nums">{r.count}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {r.userIds.map((id) => (id === myId ? "You" : (props.people[id]?.name ?? "Someone"))).join(", ")}
                </TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}

      <span
        className={cn(
          "mt-0.5 flex items-center gap-1.5 px-1 text-[0.7rem] text-muted-foreground",
          !(props.status || m.status !== "sent") && "sr-only group-hover/msg:not-sr-only",
        )}
      >
        {m.status === "failed" ? (
          <button
            type="button"
            onClick={() => props.onRetry(m.id)}
            className="flex items-center gap-1 font-semibold text-destructive"
            data-testid="retry"
          >
            <AlertCircle className="size-3.5" /> {m.error ?? "Not sent"} · Retry
          </button>
        ) : (
          <>
            <time dateTime={m.created_at}>{time(m.created_at)}</time>
            {m.edited_at && !deleted && <span data-testid="edited">· edited</span>}
            {m.status === "sending" && <span>· Sending…</span>}
            {props.status && (
              <span data-testid="receipt" className={props.status === "Read" ? "font-semibold text-mint" : undefined}>
                · {props.status}
              </span>
            )}
          </>
        )}
      </span>
    </li>
  );
});

function Action({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-ink-3 hover:text-foreground [&_svg]:size-4 [@media(hover:none)]:size-10 [@media(hover:none)]:[&_svg]:size-5"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
