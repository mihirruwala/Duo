"use client";

import { useRef, useState } from "react";
import { Paperclip, SendHorizontal, Sticker, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MAX_MESSAGE_LENGTH, UPLOAD_ACCEPT } from "@/shared/chat";
import { useChat } from "../chat-provider";
import { GifPicker } from "./gif-picker";
import { replySnippet } from "./message-item";
import { StickerPicker } from "./sticker-picker";

export function Composer({
  replyTo,
  onCancelReply,
  gifsEnabled,
}: {
  replyTo: string | null;
  onCancelReply: () => void;
  gifsEnabled: boolean;
}) {
  const chat = useChat();
  const [text, setText] = useState("");
  const [gifOpen, setGifOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const reply = replyTo ? chat.state.messages[replyTo] : undefined;
  const over = text.length > MAX_MESSAGE_LENGTH;

  function send() {
    if (!text.trim() || over) return;
    chat.sendText(text, replyTo);
    setText("");
    onCancelReply();
    inputRef.current?.focus();
  }

  function sendFiles(files: File[]) {
    if (files.length === 0) return;
    const problem = chat.sendFiles(files, replyTo);
    if (problem) toast.error(problem);
    onCancelReply();
  }

  return (
    <div className="border-t border-border p-2">
      {reply && (
        <div
          className="mb-2 flex items-center gap-2 rounded-xl border-l-3 border-violet bg-ink-1/70 px-3 py-1.5 text-xs"
          data-testid="reply-bar"
        >
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-violet">Replying to {chat.people[reply.sender_id]?.name ?? "message"}</span>
            <span className="block truncate text-muted-foreground">{replySnippet(reply)}</span>
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="grid size-6 place-items-center rounded-md hover:bg-ink-3"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-1">
        <IconButton label="Attach a photo or file" onClick={() => fileRef.current?.click()}>
          <Paperclip />
        </IconButton>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          className="hidden"
          data-testid="file-input"
          onChange={(e) => {
            sendFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />

        <Popover open={stickerOpen} onOpenChange={setStickerOpen}>
          <PopoverTrigger aria-label="Stickers" className={iconClass}>
            <Sticker />
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-auto rounded-2xl p-3">
            <StickerPicker
              onPick={(id) => {
                chat.sendSticker(id, replyTo);
                onCancelReply();
                setStickerOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>

        {gifsEnabled && (
          <Popover open={gifOpen} onOpenChange={setGifOpen}>
            <PopoverTrigger aria-label="GIF" className={cn(iconClass, "text-[0.7rem] font-extrabold")}>
              GIF
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-auto rounded-2xl p-3">
              <GifPicker
                onPick={(gif) => {
                  chat.sendGif(gif, replyTo);
                  onCancelReply();
                  setGifOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        )}

        <label className="min-w-0 flex-1">
          <span className="sr-only">Message</span>
          <textarea
            ref={inputRef}
            value={text}
            rows={1}
            placeholder={chat.partner ? `Message ${chat.partner.name}` : "Write a message"}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value) chat.notifyTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
              if (e.key === "Escape" && replyTo) onCancelReply();
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                sendFiles(files);
              }
            }}
            aria-invalid={over || undefined}
            data-testid="composer"
            className="field-sizing-content max-h-36 min-h-10 w-full resize-none rounded-2xl border border-input bg-ink-1/70 px-3.5 py-2 text-[0.95rem] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>
        <button
          type="button"
          onClick={send}
          disabled={!text.trim() || over}
          aria-label="Send"
          className="grid size-10 shrink-0 place-items-center rounded-2xl bg-coral text-ink-0 transition-[filter,opacity] hover:brightness-110 disabled:opacity-40"
        >
          <SendHorizontal className="size-5" />
        </button>
      </div>
      {text.length > MAX_MESSAGE_LENGTH - 300 && (
        <p className={cn("mt-1 text-right text-xs", over ? "text-destructive" : "text-muted-foreground")}>
          {text.length}/{MAX_MESSAGE_LENGTH}
        </p>
      )}
    </div>
  );
}

const iconClass =
  "grid size-10 shrink-0 place-items-center rounded-2xl text-muted-foreground transition-colors hover:bg-ink-3 hover:text-foreground [&_svg]:size-5";

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={iconClass}>
      {children}
    </button>
  );
}
