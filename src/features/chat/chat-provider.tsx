"use client";

import { createContext, use, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/client";
import { noteMetaSchema, type Gif, type StickerId } from "@/shared/chat";
import type { AttachmentRow, MessageKind, MessageRow, MomentRow, ReactionRow, ReceiptRow } from "@/shared/database";
import { friendlyError } from "@/shared/errors";
import { KNOCK_COOLDOWN_MS, KNOCK_EVENT, OFFLINE, partnerPresenceFrom, type PartnerPresence } from "@/shared/presence";
import { chatReducer, initialChatState, orderedMessages, type ChatMessage, type ChatState } from "./chat-reducer";
import { imageSize, uploadFile, validateFile } from "./uploads";

const PAGE = 50;
const TYPING_THROTTLE_MS = 1500;
const TYPING_TTL_MS = 4000;

export type Person = { id: string; name: string; hue: number };
export type RecordedNote = { file: File; kind: "voice" | "video"; durationMs: number; waveform?: number[] };
export type RoomChangeListener = (
  table: string,
  op: string,
  record: Record<string, unknown> | null,
  old: Record<string, unknown> | null,
) => void;

type ChatApi = {
  state: ChatState;
  messages: ChatMessage[];
  me: Person;
  partner: Person | null;
  people: Record<string, Person>;
  partnerTyping: boolean;
  partnerOnline: boolean;
  /** Where the other person is right now (Home, this room, or in the call). */
  partnerPresence: PartnerPresence;
  setInCall: (inCall: boolean) => void;
  /** Ping the other person ("I'm here, join me?"). Returns false while cooling down. */
  knock: () => boolean;
  onKnock: (listener: () => void) => () => void;
  /** Row changes for tables chat doesn't own (e.g. shared lists), from the same private room channel. */
  onRoomChange: (listener: RoomChangeListener) => () => void;
  connected: boolean;
  unread: number;
  /** Partner's watermark, for Sent / Delivered / Read on my messages. */
  partnerReceipt: ReceiptRow | undefined;
  sendText: (body: string, replyTo: string | null) => void;
  sendGif: (gif: Gif, replyTo: string | null) => void;
  sendSticker: (id: StickerId, replyTo: string | null) => void;
  sendFiles: (files: File[], replyTo: string | null) => string | null;
  /** Send one image and resolve with its message id once stored (null on failure). Optionally save it to Moments. */
  sendPhoto: (file: File, opts?: { saveToMoments?: boolean }) => Promise<string | null>;
  /** A recorded voice or video note. Returns an error message, or null once it's queued. */
  sendNote: (note: RecordedNote, replyTo: string | null) => string | null;
  retry: (id: string) => void;
  edit: (id: string, body: string) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
  toggleReaction: (id: string, emoji: string) => Promise<string | null>;
  toggleMoment: (id: string) => Promise<string | null>;
  loadOlder: () => Promise<void>;
  ensureLoaded: (id: string) => Promise<boolean>;
  notifyTyping: () => void;
  setViewing: (viewing: boolean) => void;
};

const ChatContext = createContext<ChatApi | null>(null);

/** For components that also render without chat (returns null outside the provider). */
export function useMaybeChat(): ChatApi | null {
  return use(ChatContext);
}

export function useChat(): ChatApi {
  const ctx = use(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside <ChatProvider>");
  return ctx;
}

const supabase = () => getBrowserClient();

async function fetchSideData(messageIds: string[]) {
  if (messageIds.length === 0) return { reactions: [] as ReactionRow[], attachments: [] as AttachmentRow[] };
  const [r, a] = await Promise.all([
    supabase().from("message_reactions").select("*").in("message_id", messageIds),
    supabase().from("attachments").select("*").in("message_id", messageIds),
  ]);
  if (r.error) throw r.error;
  if (a.error) throw a.error;
  return { reactions: r.data, attachments: a.data };
}

function makeOptimistic(
  roomId: string,
  myId: string,
  kind: MessageKind,
  body: string | null,
  replyTo: string | null,
  meta: MessageRow["meta"],
): ChatMessage {
  const id = crypto.randomUUID();
  return {
    id,
    client_id: id,
    seq: 0,
    room_id: roomId,
    sender_id: myId,
    kind,
    body,
    reply_to: replyTo,
    meta,
    created_at: new Date().toISOString(),
    edited_at: null,
    deleted_at: null,
    status: "sending",
  };
}

export function ChatProvider({
  roomId,
  slug,
  me,
  partner,
  children,
}: {
  roomId: string;
  slug: string;
  me: Person;
  partner: Person | null;
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [partnerTypingAt, setPartnerTypingAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [partnerPresence, setPartnerPresence] = useState<PartnerPresence>(OFFLINE);
  const partnerOnline = partnerPresence.online;
  const inCallRef = useRef(false);
  const lastKnockSent = useRef(0);
  const knockListeners = useRef(new Set<() => void>());
  const roomChangeListeners = useRef(new Set<RoomChangeListener>());
  const [connected, setConnected] = useState(false);
  const [viewing, setViewing] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  // Latest state for async callbacks (synced after each commit, never during render).
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });
  const lastTypingSent = useRef(0);
  const pendingFiles = useRef(new Map<string, { file: File; replyTo: string | null }>());
  const people = useMemo<Record<string, Person>>(
    () => ({ [me.id]: me, ...(partner ? { [partner.id]: partner } : {}) }),
    [me, partner],
  );

  // ── Loading ────────────────────────────────────────────────────────────────

  const loadLatest = useCallback(async () => {
    const [msgs, moments, receipts] = await Promise.all([
      supabase()
        .from("messages")
        .select("*")
        .eq("room_id", roomId)
        .order("seq", { ascending: false })
        .limit(PAGE + 1),
      supabase().from("moments").select("*").eq("room_id", roomId),
      supabase().from("message_receipts").select("*").eq("room_id", roomId),
    ]);
    if (msgs.error || moments.error || receipts.error) return;
    const rows = msgs.data.slice(0, PAGE);
    const side = await fetchSideData(rows.map((m) => m.id)).catch(() => null);
    if (!side) return;
    dispatch({
      type: "loaded",
      messages: rows,
      reactions: side.reactions,
      attachments: side.attachments,
      moments: moments.data,
      receipts: receipts.data,
      hasMoreOlder: msgs.data.length > PAGE,
    });
  }, [roomId]);

  /** After a reconnect: pull everything newer than what we have, and refresh the recent window. */
  const resync = useCallback(async () => {
    const s = stateRef.current;
    if (!s.loaded) return loadLatest();
    const sent = Object.values(s.messages).filter((m) => m.status === "sent");
    const newest = sent.reduce((max, m) => Math.max(max, m.seq), 0);
    const [newer, recent, moments, receipts] = await Promise.all([
      supabase().from("messages").select("*").eq("room_id", roomId).gt("seq", newest).order("seq").limit(500),
      supabase().from("messages").select("*").eq("room_id", roomId).order("seq", { ascending: false }).limit(PAGE),
      supabase().from("moments").select("*").eq("room_id", roomId),
      supabase().from("message_receipts").select("*").eq("room_id", roomId),
    ]);
    if (newer.error || recent.error || moments.error || receipts.error) return;
    const rows = [...recent.data, ...newer.data];
    const ids = [...new Set(rows.map((m) => m.id))];
    const side = await fetchSideData(ids).catch(() => null);
    if (!side) return;
    dispatch({
      type: "merge",
      messages: rows,
      reactions: { messageIds: ids, rows: side.reactions },
      attachments: side.attachments,
    });
    const currentMoments = Object.values(stateRef.current.moments);
    for (const m of currentMoments)
      if (!moments.data.some((x) => x.id === m.id)) dispatch({ type: "moment", op: "remove", row: m });
    for (const m of moments.data) dispatch({ type: "moment", op: "add", row: m });
    for (const r of receipts.data) dispatch({ type: "receipt", row: r });
  }, [loadLatest, roomId]);

  const loadOlder = useCallback(async () => {
    const sent = Object.values(stateRef.current.messages).filter((m) => m.status === "sent");
    if (sent.length === 0) return;
    const oldest = sent.reduce((min, m) => Math.min(min, m.seq), Number.POSITIVE_INFINITY);
    const { data, error } = await supabase()
      .from("messages")
      .select("*")
      .eq("room_id", roomId)
      .lt("seq", oldest)
      .order("seq", { ascending: false })
      .limit(PAGE + 1);
    if (error) return;
    const rows = data.slice(0, PAGE);
    const side = await fetchSideData(rows.map((m) => m.id)).catch(() => null);
    if (!side) return;
    dispatch({
      type: "older",
      messages: rows,
      reactions: side.reactions,
      attachments: side.attachments,
      hasMoreOlder: data.length > PAGE,
    });
  }, [roomId]);

  /** Make sure a (possibly old) message is loaded, e.g. to jump to a reply's original. */
  const ensureLoaded = useCallback(
    async (id: string) => {
      if (stateRef.current.messages[id]) return true;
      const { data: target } = await supabase().from("messages").select("seq").eq("id", id).eq("room_id", roomId).maybeSingle();
      if (!target) return false;
      const sent = Object.values(stateRef.current.messages).filter((m) => m.status === "sent");
      const oldest = sent.reduce((min, m) => Math.min(min, m.seq), Number.POSITIVE_INFINITY);
      const { data, error } = await supabase()
        .from("messages")
        .select("*")
        .eq("room_id", roomId)
        .gte("seq", Number(target.seq) - 5)
        .lt("seq", oldest)
        .order("seq")
        .limit(500);
      if (error) return false;
      const side = await fetchSideData(data.map((m) => m.id)).catch(() => null);
      if (!side) return false;
      dispatch({ type: "older", messages: data, reactions: side.reactions, attachments: side.attachments, hasMoreOlder: true });
      return true;
    },
    [roomId],
  );

  // ── Realtime ───────────────────────────────────────────────────────────────

  useEffect(() => {
    let alive = true;
    let firstSubscribe = true;
    const client = supabase();

    void (async () => {
      await client.realtime.setAuth();
      if (!alive) return;
      const channel = client.channel(`room:${roomId}`, {
        config: { private: true, broadcast: { self: false }, presence: { key: me.id } },
      });
      channel
        .on("broadcast", { event: "*" }, ({ event, payload }) => {
          if (event === KNOCK_EVENT) {
            const p = payload as { userId?: string };
            if (p.userId && p.userId !== me.id) knockListeners.current.forEach((l) => l());
            return;
          }
          if (event === "typing") {
            const p = payload as { userId?: string; stop?: boolean };
            if (p.userId && p.userId !== me.id) setPartnerTypingAt(p.stop ? 0 : Date.now());
            return;
          }
          const p = payload as { table?: string; operation?: string; record?: unknown; old_record?: unknown };
          applyChange(p.table, p.operation, p.record, p.old_record);
        })
        .on("presence", { event: "sync" }, () => {
          setPartnerPresence(partnerPresenceFrom(channel.presenceState() as Record<string, unknown[]>, me.id));
        })
        .subscribe((status) => {
          if (!alive) return;
          if (status === "SUBSCRIBED") {
            setConnected(true);
            void channel.track({ where: "room", inCall: inCallRef.current, at: new Date().toISOString() });
            if (firstSubscribe) {
              firstSubscribe = false;
              void loadLatest();
            } else {
              void resync();
            }
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setConnected(false);
          }
        });
      channelRef.current = channel;
    })();

    function applyChange(table: string | undefined, op: string | undefined, record: unknown, oldRecord: unknown) {
      const rec = (record ?? null) as Record<string, unknown> | null;
      const old = (oldRecord ?? null) as Record<string, unknown> | null;
      if (rec && rec.room_id !== roomId && old?.room_id !== roomId) return;
      if (table && op) roomChangeListeners.current.forEach((l) => l(table, op, rec, old));
      switch (table) {
        case "messages":
          if (rec) dispatch({ type: "message", row: rec as unknown as MessageRow });
          break;
        case "message_reactions":
          if (op === "INSERT" && rec) dispatch({ type: "reaction", op: "add", row: rec as unknown as ReactionRow });
          if (op === "DELETE" && old) dispatch({ type: "reaction", op: "remove", row: old as unknown as ReactionRow });
          break;
        case "attachments":
          if (op === "DELETE" && old) dispatch({ type: "attachment", op: "remove", row: old as unknown as AttachmentRow });
          else if (rec) dispatch({ type: "attachment", op: "upsert", row: rec as unknown as AttachmentRow });
          break;
        case "moments":
          if (op === "INSERT" && rec) dispatch({ type: "moment", op: "add", row: rec as unknown as MomentRow });
          if (op === "DELETE" && old) dispatch({ type: "moment", op: "remove", row: old as unknown as MomentRow });
          break;
        case "message_receipts":
          if (rec) dispatch({ type: "receipt", row: rec as unknown as ReceiptRow });
          break;
      }
    }

    const onOnline = () => void resync();
    const onVisible = () => document.visibilityState === "visible" && void resync();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      if (channelRef.current) void client.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [roomId, me.id, loadLatest, resync]);

  // Typing indicator expiry.
  useEffect(() => {
    if (!partnerTypingAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [partnerTypingAt]);
  const partnerTyping = partnerTypingAt > 0 && now - partnerTypingAt < TYPING_TTL_MS;

  const notifyTyping = useCallback(() => {
    const t = Date.now();
    if (t - lastTypingSent.current < TYPING_THROTTLE_MS) return;
    lastTypingSent.current = t;
    void channelRef.current?.send({ type: "broadcast", event: "typing", payload: { userId: me.id } });
  }, [me.id]);

  const stopTyping = useCallback(() => {
    lastTypingSent.current = 0;
    void channelRef.current?.send({ type: "broadcast", event: "typing", payload: { userId: me.id, stop: true } });
  }, [me.id]);

  // ── Receipts ───────────────────────────────────────────────────────────────

  const messages = useMemo(() => orderedMessages(state), [state]);
  const myReceipt = state.receipts[me.id];
  const partnerReceipt = partner ? state.receipts[partner.id] : undefined;
  const maxIncoming = useMemo(
    () => messages.reduce((max, m) => (m.status === "sent" && m.sender_id !== me.id ? Math.max(max, m.seq) : max), 0),
    [messages, me.id],
  );
  const myRead = Number(myReceipt?.read_seq ?? 0);
  const myDelivered = Number(myReceipt?.delivered_seq ?? 0);
  const wantRead = viewing ? maxIncoming : myRead;

  useEffect(() => {
    if (!state.loaded || maxIncoming === 0) return;
    if (maxIncoming <= myDelivered && wantRead <= myRead) return;
    const t = setTimeout(() => {
      void supabase()
        .rpc("mark_receipts", { p_room_id: roomId, p_delivered_seq: maxIncoming, p_read_seq: Math.max(wantRead, myRead) })
        .then(({ data }) => data && dispatch({ type: "receipt", row: data }));
    }, 400);
    return () => clearTimeout(t);
  }, [state.loaded, maxIncoming, myDelivered, myRead, wantRead, roomId]);

  const unread = useMemo(
    () => messages.filter((m) => m.status === "sent" && m.sender_id !== me.id && m.seq > myRead && !m.deleted_at).length,
    [messages, me.id, myRead],
  );

  // ── Sending ────────────────────────────────────────────────────────────────

  // Sends from this tab go out one at a time, so the server's seq order always matches the
  // order the person typed them (parallel inserts could otherwise race and swap).
  const sendQueue = useRef<Promise<void>>(Promise.resolve());
  const insert = useCallback((msg: ChatMessage) => {
    sendQueue.current = sendQueue.current.then(async () => {
      const { data, error } = await supabase()
        .from("messages")
        .insert({
          id: msg.id,
          room_id: msg.room_id,
          client_id: msg.client_id,
          kind: msg.kind,
          body: msg.body,
          reply_to: msg.reply_to,
          meta: msg.meta,
        })
        .select("*")
        .single();
      if (error || !data) dispatch({ type: "failed", id: msg.id, error: friendlyError(error, "Not sent. Tap to retry.") });
      else dispatch({ type: "message", row: data });
    });
    return sendQueue.current;
  }, []);

  const sendText = useCallback(
    (body: string, replyTo: string | null) => {
      const text = body.trim();
      if (!text) return;
      const msg = makeOptimistic(roomId, me.id, "text", text, replyTo, {});
      dispatch({ type: "optimistic", message: msg });
      stopTyping();
      void insert(msg);
    },
    [roomId, me.id, insert, stopTyping],
  );

  const sendGif = useCallback(
    (gif: Gif, replyTo: string | null) => {
      const msg = makeOptimistic(roomId, me.id, "gif", null, replyTo, {
        giphy_id: gif.id,
        url: gif.url,
        width: gif.width,
        height: gif.height,
        title: gif.title,
      });
      dispatch({ type: "optimistic", message: msg });
      void insert(msg);
    },
    [roomId, me.id, insert],
  );

  const sendSticker = useCallback(
    (id: StickerId, replyTo: string | null) => {
      const msg = makeOptimistic(roomId, me.id, "sticker", null, replyTo, { sticker_id: id });
      dispatch({ type: "optimistic", message: msg });
      void insert(msg);
    },
    [roomId, me.id, insert],
  );

  const runUpload = useCallback(
    async (msg: ChatMessage, file: File) => {
      try {
        const dims = await imageSize(file);
        const note = msg.kind === "voice" || msg.kind === "video" ? noteMetaSchema.safeParse(msg.meta) : null;
        if (note && !note.success) throw new Error("This recording is damaged. Record it again.");
        const target = await uploadFile(slug, file, (p) => dispatch({ type: "progress", id: msg.id, progress: p }));
        const { data, error } = await supabase().rpc("send_attachment_message", {
          p_room_id: roomId,
          p_client_id: msg.id,
          p_kind: msg.kind,
          p_body: null,
          p_reply_to: msg.reply_to,
          p_storage_path: target.path,
          p_mime_type: file.type,
          p_size_bytes: file.size,
          p_file_name: target.fileName,
          p_width: dims?.width ?? null,
          p_height: dims?.height ?? null,
          ...(note?.success ? { p_duration_ms: note.data.duration_ms, p_waveform: note.data.waveform ?? null } : {}),
        });
        if (error || !data) throw new Error(friendlyError(error, "Upload failed. Tap to retry."));
        dispatch({ type: "message", row: data });
        pendingFiles.current.delete(msg.id);
        return true;
      } catch (err) {
        dispatch({ type: "failed", id: msg.id, error: (err as Error).message || "Upload failed. Tap to retry." });
        return false;
      }
    },
    [roomId, slug],
  );

  const sendFiles = useCallback(
    (files: File[], replyTo: string | null): string | null => {
      for (const file of files) {
        const problem = validateFile(file);
        if (problem) return problem;
      }
      for (const file of files.slice(0, 10)) {
        const kind: MessageKind = file.type.startsWith("image/") ? "image" : "file";
        const msg = makeOptimistic(roomId, me.id, kind, null, replyTo, {
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        });
        msg.progress = 0;
        if (kind === "image") msg.localPreview = URL.createObjectURL(file);
        pendingFiles.current.set(msg.id, { file, replyTo });
        dispatch({ type: "optimistic", message: msg });
        void runUpload(msg, file);
      }
      return files.length > 10 ? "Only the first 10 files were sent." : null;
    },
    [roomId, me.id, runUpload],
  );

  const sendPhoto = useCallback(
    async (file: File, opts: { saveToMoments?: boolean } = {}) => {
      if (validateFile(file)) return null;
      const msg = makeOptimistic(roomId, me.id, "image", null, null, {
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      });
      msg.progress = 0;
      msg.localPreview = URL.createObjectURL(file);
      pendingFiles.current.set(msg.id, { file, replyTo: null });
      dispatch({ type: "optimistic", message: msg });
      if (!(await runUpload(msg, file))) return null;
      if (opts.saveToMoments) {
        const { data } = await supabase().from("moments").insert({ message_id: msg.id }).select("*").single();
        if (data) dispatch({ type: "moment", op: "add", row: data });
      }
      return msg.id;
    },
    [roomId, me.id, runUpload],
  );

  const sendNote = useCallback(
    (note: RecordedNote, replyTo: string | null): string | null => {
      const problem = validateFile(note.file, { note: true });
      if (problem) return problem;
      const msg = makeOptimistic(roomId, me.id, note.kind, null, replyTo, {
        file_name: note.file.name,
        mime_type: note.file.type,
        size_bytes: note.file.size,
        duration_ms: Math.round(note.durationMs),
        ...(note.waveform ? { waveform: note.waveform } : {}),
      });
      msg.progress = 0;
      msg.localPreview = URL.createObjectURL(note.file);
      pendingFiles.current.set(msg.id, { file: note.file, replyTo });
      dispatch({ type: "optimistic", message: msg });
      void runUpload(msg, note.file);
      return null;
    },
    [roomId, me.id, runUpload],
  );

  const retry = useCallback(
    (id: string) => {
      const msg = stateRef.current.messages[id];
      if (!msg || msg.status !== "failed") return;
      const retrying: ChatMessage = {
        ...msg,
        status: "sending",
        error: undefined,
        progress: ["image", "file", "voice", "video"].includes(msg.kind) ? 0 : undefined,
      };
      dispatch({ type: "optimistic", message: retrying });
      const pending = pendingFiles.current.get(id);
      if (pending) void runUpload(retrying, pending.file);
      else void insert(retrying);
    },
    [insert, runUpload],
  );

  // ── Editing, deleting, reactions, Moments ─────────────────────────────────

  const edit = useCallback(async (id: string, body: string) => {
    const text = body.trim();
    if (!text) return "A message can't be empty.";
    const { data, error } = await supabase().from("messages").update({ body: text }).eq("id", id).select("*").single();
    if (error || !data) return friendlyError(error);
    dispatch({ type: "message", row: data });
    return null;
  }, []);

  const remove = useCallback(async (id: string) => {
    const attachment = stateRef.current.attachments[id];
    const { data, error } = await supabase()
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) return friendlyError(error);
    dispatch({ type: "message", row: data });
    if (attachment) {
      dispatch({ type: "attachment", op: "remove", row: attachment });
      void supabase().storage.from("attachments").remove([attachment.storage_path]);
    }
    return null;
  }, []);

  const toggleReaction = useCallback(
    async (id: string, emoji: string) => {
      const mine = (stateRef.current.reactions[id] ?? []).some((r) => r.user_id === me.id && r.emoji === emoji);
      const row: ReactionRow = { message_id: id, user_id: me.id, emoji, room_id: roomId, created_at: new Date().toISOString() };
      dispatch({ type: "reaction", op: mine ? "remove" : "add", row });
      const { error } = mine
        ? await supabase().from("message_reactions").delete().eq("message_id", id).eq("user_id", me.id).eq("emoji", emoji)
        : await supabase().from("message_reactions").insert({ message_id: id, emoji });
      if (error) {
        dispatch({ type: "reaction", op: mine ? "add" : "remove", row });
        return friendlyError(error);
      }
      return null;
    },
    [me.id, roomId],
  );

  const toggleMoment = useCallback(async (id: string) => {
    const existing = stateRef.current.moments[id];
    if (existing) {
      const { error } = await supabase().from("moments").delete().eq("id", existing.id);
      if (error) return friendlyError(error);
      dispatch({ type: "moment", op: "remove", row: existing });
      return null;
    }
    const { data, error } = await supabase().from("moments").insert({ message_id: id }).select("*").single();
    if (error || !data) return friendlyError(error);
    dispatch({ type: "moment", op: "add", row: data });
    return null;
  }, []);

  const setInCall = useCallback((inCall: boolean) => {
    if (inCallRef.current === inCall) return;
    inCallRef.current = inCall;
    void channelRef.current?.track({ where: "room", inCall, at: new Date().toISOString() });
  }, []);

  const knock = useCallback(() => {
    const now = Date.now();
    if (now - lastKnockSent.current < KNOCK_COOLDOWN_MS || !channelRef.current) return false;
    lastKnockSent.current = now;
    void channelRef.current.send({ type: "broadcast", event: KNOCK_EVENT, payload: { userId: me.id } });
    return true;
  }, [me.id]);

  const onKnock = useCallback((listener: () => void) => {
    knockListeners.current.add(listener);
    return () => {
      knockListeners.current.delete(listener);
    };
  }, []);

  const onRoomChange = useCallback((listener: RoomChangeListener) => {
    roomChangeListeners.current.add(listener);
    return () => {
      roomChangeListeners.current.delete(listener);
    };
  }, []);

  const api: ChatApi = {
    state,
    messages,
    me,
    partner,
    people,
    partnerTyping,
    partnerOnline,
    partnerPresence,
    setInCall,
    knock,
    onKnock,
    onRoomChange,
    connected,
    unread,
    partnerReceipt,
    sendText,
    sendGif,
    sendSticker,
    sendFiles,
    sendPhoto,
    sendNote,
    retry,
    edit,
    remove,
    toggleReaction,
    toggleMoment,
    loadOlder,
    ensureLoaded,
    notifyTyping,
    setViewing,
  };

  return <ChatContext value={api}>{children}</ChatContext>;
}
