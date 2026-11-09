"use client";

import { haptic } from "@/lib/haptics";
import { useEffect, useRef, useState } from "react";
import { FileUp, Loader2, Mic, Paperclip, SendHorizontal, Sticker, Trash2, Video, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatDuration, MAX_MESSAGE_LENGTH, MAX_VIDEO_MS, MAX_VOICE_MS, UPLOAD_ACCEPT } from "@/shared/chat";
import { useChat, type RecordedNote } from "../chat-provider";
import { useNoteRecorder } from "../use-note-recorder";
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

  function sendNote(note: RecordedNote) {
    const problem = chat.sendNote(note, replyTo);
    if (problem) toast.error(problem);
    onCancelReply();
  }
  const recorder = useNoteRecorder({
    onAutoStop: (note) => {
      toast(`That's the ${note.kind === "video" ? "1-minute" : "5-minute"} limit. Sent.`);
      sendNote(note);
    },
  });

  async function record(kind: "voice" | "video") {
    const problem = await recorder.start(kind);
    if (problem) toast.error(problem);
  }
  async function finishRecording() {
    const note = await recorder.stop();
    if (note) sendNote(note);
    else toast("Too short to send. Hold on a little longer.");
  }

  function send() {
    if (!text.trim() || over) return;
    chat.sendText(text, replyTo);
    haptic("light");
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
    <div className="border-t border-border p-2 max-sm:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
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

      {recorder.state.phase !== "idle" ? (
        <RecordingBar
          kind={recorder.state.kind}
          starting={recorder.state.phase === "starting"}
          stream={recorder.state.phase === "recording" ? recorder.state.stream : null}
          elapsed={recorder.elapsed}
          level={recorder.level}
          onCancel={recorder.cancel}
          onSend={() => void finishRecording()}
        />
      ) : (
        <div className="flex items-end gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="Attach" className={iconClass}>
              <Paperclip />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start">
              <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
                <FileUp /> Photo or file
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void record("video")} data-testid="record-video">
                <Video /> Video note
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          {text.trim() ? (
            <button
              type="button"
              onClick={send}
              disabled={over}
              aria-label="Send"
              className="grid size-10 shrink-0 place-items-center rounded-2xl bg-coral text-ink-0 transition-[filter,opacity] hover:brightness-110 disabled:opacity-40"
            >
              <SendHorizontal className="size-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void record("voice")}
              aria-label="Record a voice message"
              data-testid="record-voice"
              className="grid size-10 shrink-0 place-items-center rounded-2xl bg-coral text-ink-0 transition-[filter,opacity] hover:brightness-110"
            >
              <Mic className="size-5" />
            </button>
          )}
        </div>
      )}
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

function RecordingBar({
  kind,
  starting,
  stream,
  elapsed,
  level,
  onCancel,
  onSend,
}: {
  kind: "voice" | "video";
  starting: boolean;
  stream: MediaStream | null;
  elapsed: number;
  level: number;
  onCancel: () => void;
  onSend: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [bars, setBars] = useState<number[]>([]);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);
  // A rolling level meter (last ~3 s).
  useEffect(() => {
    if (starting) return;
    const t = setTimeout(() => setBars((b) => [...b.slice(-29), level]), 0);
    return () => clearTimeout(t);
  }, [level, starting]);
  const max = kind === "video" ? MAX_VIDEO_MS : MAX_VOICE_MS;

  return (
    <div className="flex flex-col gap-2" data-testid="recording-bar">
      {kind === "video" && (
        <div className="mx-auto aspect-square w-40 overflow-hidden rounded-[2rem] bg-ink-1 ring-2 ring-danger/70">
          {stream ? (
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" />
          ) : (
            <span className="grid h-full place-items-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Discard recording"
          className="grid size-10 shrink-0 place-items-center rounded-2xl text-muted-foreground hover:bg-ink-3 hover:text-danger"
        >
          <Trash2 className="size-5" />
        </button>
        <span className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-ink-1/70 px-3 py-2" role="status">
          <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden />
          <span className="font-mono text-sm tabular-nums" data-testid="recording-time">
            {starting ? "Starting…" : formatDuration(elapsed)}
          </span>
          <span className="sr-only">Recording {kind === "video" ? "a video" : "a voice"} message</span>
          <span className="flex h-6 flex-1 items-center justify-end gap-0.5 overflow-hidden" aria-hidden>
            {bars.map((b, i) => (
              <span key={i} className="w-1 shrink-0 rounded-full bg-coral" style={{ height: `${Math.max(12, b * 100)}%` }} />
            ))}
          </span>
          <span className="text-xs text-muted-foreground">{formatDuration(max)}</span>
        </span>
        <button
          type="button"
          onClick={onSend}
          disabled={starting}
          aria-label="Send recording"
          data-testid="recording-send"
          className="grid size-10 shrink-0 place-items-center rounded-2xl bg-coral text-ink-0 transition-[filter,opacity] hover:brightness-110 disabled:opacity-40"
        >
          <SendHorizontal className="size-5" />
        </button>
      </div>
    </div>
  );
}
