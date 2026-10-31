import type { AttachmentRow, MessageRow, MomentRow, ReactionRow, ReceiptRow } from "@/shared/database";

/** A message as the UI sees it: server row + local delivery state. */
export type ChatMessage = MessageRow & {
  /** "sending" = optimistic, not yet confirmed; "failed" = needs retry. Server rows are "sent". */
  status: "sending" | "sent" | "failed";
  error?: string;
  /** Local object URL for an image still uploading. */
  localPreview?: string;
  /** Upload progress 0..1 for image/file messages in flight. */
  progress?: number;
};

export type ChatState = {
  messages: Record<string, ChatMessage>;
  reactions: Record<string, ReactionRow[]>; // by message id
  attachments: Record<string, AttachmentRow>; // by message id
  moments: Record<string, MomentRow>; // by message id
  receipts: Record<string, ReceiptRow>; // by user id
  hasMoreOlder: boolean;
  loaded: boolean;
};

export const initialChatState: ChatState = {
  messages: {},
  reactions: {},
  attachments: {},
  moments: {},
  receipts: {},
  hasMoreOlder: false,
  loaded: false,
};

export type ChatAction =
  | {
      type: "loaded";
      messages: MessageRow[];
      reactions: ReactionRow[];
      attachments: AttachmentRow[];
      moments: MomentRow[];
      receipts: ReceiptRow[];
      hasMoreOlder: boolean;
    }
  | { type: "older"; messages: MessageRow[]; reactions: ReactionRow[]; attachments: AttachmentRow[]; hasMoreOlder: boolean }
  | {
      type: "merge";
      messages: MessageRow[];
      reactions?: { messageIds: string[]; rows: ReactionRow[] };
      attachments?: AttachmentRow[];
    }
  | { type: "optimistic"; message: ChatMessage }
  | { type: "progress"; id: string; progress: number }
  | { type: "failed"; id: string; error: string }
  | { type: "message"; row: MessageRow }
  | { type: "reaction"; op: "add" | "remove"; row: ReactionRow }
  | { type: "attachment"; op: "upsert" | "remove"; row: AttachmentRow }
  | { type: "moment"; op: "add" | "remove"; row: MomentRow }
  | { type: "receipt"; row: ReceiptRow };

/** Server rows always win over optimistic copies, except we keep a local preview until the real image is up. */
function mergeMessage(prev: ChatMessage | undefined, row: MessageRow): ChatMessage {
  // Realtime can deliver an older version after a newer one (e.g. INSERT after our UPDATE response).
  if (prev && prev.status === "sent") {
    const prevVersion = Math.max(Date.parse(prev.edited_at ?? "") || 0, Date.parse(prev.deleted_at ?? "") || 0);
    const rowVersion = Math.max(Date.parse(row.edited_at ?? "") || 0, Date.parse(row.deleted_at ?? "") || 0);
    if (prev.deleted_at && !row.deleted_at) return prev;
    if (rowVersion < prevVersion) return prev;
  }
  return { ...row, seq: Number(row.seq), status: "sent", localPreview: prev?.localPreview };
}

function addReaction(list: ReactionRow[] | undefined, row: ReactionRow): ReactionRow[] {
  const rest = (list ?? []).filter((r) => !(r.user_id === row.user_id && r.emoji === row.emoji));
  return [...rest, row];
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "loaded": {
      // Merge, never replace: a load can resolve after newer realtime events or our own send
      // confirmations, and a snapshot taken earlier must not erase them. Deletes are tombstones,
      // so a merge never resurrects anything.
      const messages = { ...state.messages };
      for (const row of action.messages) messages[row.id] = mergeMessage(messages[row.id], row);
      const fetchedIds = new Set(action.messages.map((m) => m.id));
      const reactions = { ...state.reactions };
      for (const id of fetchedIds) delete reactions[id];
      Object.assign(
        reactions,
        groupBy(action.reactions, (r) => r.message_id),
      );
      const attachments = { ...state.attachments };
      for (const a of action.attachments) if (a.message_id) attachments[a.message_id] = a;
      const moments = { ...state.moments, ...Object.fromEntries(action.moments.map((m) => [m.message_id, m])) };
      let next: ChatState = {
        ...state,
        messages,
        reactions,
        attachments,
        moments,
        hasMoreOlder: action.hasMoreOlder,
        loaded: true,
      };
      for (const r of action.receipts) next = chatReducer(next, { type: "receipt", row: r });
      return next;
    }
    case "older":
    case "merge": {
      const messages = { ...state.messages };
      for (const row of action.messages) messages[row.id] = mergeMessage(messages[row.id], row);
      let reactions = state.reactions;
      if (action.type === "older") reactions = { ...reactions, ...groupBy(action.reactions, (r) => r.message_id) };
      else if (action.reactions) {
        reactions = { ...reactions };
        for (const id of action.reactions.messageIds) delete reactions[id];
        Object.assign(
          reactions,
          groupBy(action.reactions.rows, (r) => r.message_id),
        );
      }
      const attachments = { ...state.attachments };
      for (const a of action.attachments ?? []) if (a.message_id) attachments[a.message_id] = a;
      return {
        ...state,
        messages,
        reactions,
        attachments,
        hasMoreOlder: action.type === "older" ? action.hasMoreOlder : state.hasMoreOlder,
      };
    }
    case "optimistic":
      return { ...state, messages: { ...state.messages, [action.message.id]: action.message } };
    case "progress": {
      const m = state.messages[action.id];
      if (!m || m.status !== "sending") return state;
      return { ...state, messages: { ...state.messages, [action.id]: { ...m, progress: action.progress } } };
    }
    case "failed": {
      const m = state.messages[action.id];
      if (!m || m.status === "sent") return state;
      return { ...state, messages: { ...state.messages, [action.id]: { ...m, status: "failed", error: action.error } } };
    }
    case "message":
      return {
        ...state,
        messages: { ...state.messages, [action.row.id]: mergeMessage(state.messages[action.row.id], action.row) },
      };
    case "reaction": {
      const id = action.row.message_id;
      const list =
        action.op === "add"
          ? addReaction(state.reactions[id], action.row)
          : (state.reactions[id] ?? []).filter((r) => !(r.user_id === action.row.user_id && r.emoji === action.row.emoji));
      return { ...state, reactions: { ...state.reactions, [id]: list } };
    }
    case "attachment": {
      const id = action.row.message_id;
      if (!id) return state;
      const attachments = { ...state.attachments };
      if (action.op === "upsert") attachments[id] = action.row;
      else delete attachments[id];
      return { ...state, attachments };
    }
    case "moment": {
      const moments = { ...state.moments };
      if (action.op === "add") moments[action.row.message_id] = action.row;
      else delete moments[action.row.message_id];
      return { ...state, moments };
    }
    case "receipt": {
      const prev = state.receipts[action.row.user_id];
      const row = {
        ...action.row,
        delivered_seq: Math.max(Number(action.row.delivered_seq), Number(prev?.delivered_seq ?? 0)),
        read_seq: Math.max(Number(action.row.read_seq), Number(prev?.read_seq ?? 0)),
      };
      return { ...state, receipts: { ...state.receipts, [row.user_id]: row } };
    }
  }
}

function groupBy<T>(rows: T[], key: (r: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[key(r)] ??= []).push(r);
  return out;
}

/**
 * Display order: confirmed messages by server `seq` (a total order), then optimistic ones in the
 * order they were sent. This is what guarantees both people see the same sequence.
 */
export function orderedMessages(state: ChatState): ChatMessage[] {
  return Object.values(state.messages).sort((a, b) => {
    const as = a.status === "sent" ? a.seq : Number.POSITIVE_INFINITY;
    const bs = b.status === "sent" ? b.seq : Number.POSITIVE_INFINITY;
    if (as !== bs) return as - bs;
    return Date.parse(a.created_at) - Date.parse(b.created_at);
  });
}

export type ReactionSummary = { emoji: string; count: number; mine: boolean; userIds: string[] };

export function summarizeReactions(rows: ReactionRow[] | undefined, myId: string): ReactionSummary[] {
  const byEmoji = new Map<string, ReactionSummary>();
  for (const r of [...(rows ?? [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    const s = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, userIds: [] };
    s.count += 1;
    s.userIds.push(r.user_id);
    if (r.user_id === myId) s.mine = true;
    byEmoji.set(r.emoji, s);
  }
  return [...byEmoji.values()];
}
