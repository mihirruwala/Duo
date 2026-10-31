import { describe, expect, it } from "vitest";
import {
  chatReducer,
  initialChatState,
  orderedMessages,
  summarizeReactions,
  type ChatMessage,
} from "@/features/chat/chat-reducer";
import type { MessageRow } from "@/shared/database";

const row = (id: string, seq: number, extra: Partial<MessageRow> = {}): MessageRow => ({
  id,
  seq,
  room_id: "r",
  sender_id: "u1",
  client_id: id,
  kind: "text",
  body: `m${seq}`,
  reply_to: null,
  meta: {},
  created_at: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
  edited_at: null,
  deleted_at: null,
  ...extra,
});

const loaded = (messages: MessageRow[]) =>
  chatReducer(initialChatState, {
    type: "loaded",
    messages,
    reactions: [],
    attachments: [],
    moments: [],
    receipts: [],
    hasMoreOlder: false,
  });

describe("chat reducer", () => {
  it("orders by server seq regardless of arrival order", () => {
    let s = loaded([row("c", 3), row("a", 1)]);
    s = chatReducer(s, { type: "message", row: row("b", 2) });
    expect(orderedMessages(s).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("optimistic messages sit at the end until confirmed, then take their seq slot", () => {
    let s = loaded([row("a", 1)]);
    const pending: ChatMessage = { ...row("p", 0), status: "sending" };
    s = chatReducer(s, { type: "optimistic", message: pending });
    s = chatReducer(s, { type: "message", row: row("b", 2) });
    expect(orderedMessages(s).map((m) => `${m.id}:${m.status}`)).toEqual(["a:sent", "b:sent", "p:sending"]);
    s = chatReducer(s, { type: "message", row: row("p", 3) });
    expect(orderedMessages(s).map((m) => `${m.id}:${m.status}`)).toEqual(["a:sent", "b:sent", "p:sent"]);
  });

  it("a duplicate INSERT broadcast after our own confirmation is harmless (idempotent)", () => {
    let s = loaded([]);
    s = chatReducer(s, { type: "message", row: row("x", 5) });
    s = chatReducer(s, { type: "message", row: row("x", 5) });
    expect(orderedMessages(s)).toHaveLength(1);
  });

  it("a late, stale event can't undo an edit or revive a deleted message", () => {
    let s = loaded([row("x", 1)]);
    s = chatReducer(s, { type: "message", row: row("x", 1, { body: "edited", edited_at: new Date().toISOString() }) });
    s = chatReducer(s, { type: "message", row: row("x", 1) }); // stale INSERT
    expect(s.messages.x!.body).toBe("edited");
    s = chatReducer(s, { type: "message", row: row("x", 1, { body: null, deleted_at: new Date().toISOString() }) });
    s = chatReducer(s, { type: "message", row: row("x", 1, { body: "edited", edited_at: new Date().toISOString() }) });
    expect(s.messages.x!.deleted_at).not.toBeNull();
  });

  it("reload keeps in-flight optimistic messages", () => {
    let s = loaded([row("a", 1)]);
    s = chatReducer(s, { type: "optimistic", message: { ...row("p", 0), status: "sending" } });
    s = chatReducer(s, {
      type: "loaded",
      messages: [row("a", 1), row("b", 2)],
      reactions: [],
      attachments: [],
      moments: [],
      receipts: [],
      hasMoreOlder: false,
    });
    expect(orderedMessages(s).map((m) => m.id)).toEqual(["a", "b", "p"]);
  });

  it("reactions add/remove and summarize with counts + mine", () => {
    let s = loaded([row("a", 1)]);
    const r = (user: string, emoji: string) => ({
      message_id: "a",
      user_id: user,
      emoji,
      room_id: "r",
      created_at: new Date().toISOString(),
    });
    s = chatReducer(s, { type: "reaction", op: "add", row: r("u1", "❤️") });
    s = chatReducer(s, { type: "reaction", op: "add", row: r("u2", "❤️") });
    s = chatReducer(s, { type: "reaction", op: "add", row: r("u2", "😂") });
    s = chatReducer(s, { type: "reaction", op: "add", row: r("u2", "😂") }); // duplicate event
    expect(summarizeReactions(s.reactions.a, "u1")).toEqual([
      { emoji: "❤️", count: 2, mine: true, userIds: ["u1", "u2"] },
      { emoji: "😂", count: 1, mine: false, userIds: ["u2"] },
    ]);
    s = chatReducer(s, { type: "reaction", op: "remove", row: r("u1", "❤️") });
    expect(summarizeReactions(s.reactions.a, "u1")[0]).toMatchObject({ emoji: "❤️", count: 1, mine: false });
  });

  it("receipts never move backwards", () => {
    let s = loaded([]);
    const rc = (d: number, r: number) => ({ room_id: "r", user_id: "u2", delivered_seq: d, read_seq: r, updated_at: "" });
    s = chatReducer(s, { type: "receipt", row: rc(5, 4) });
    s = chatReducer(s, { type: "receipt", row: rc(3, 2) });
    expect(s.receipts.u2).toMatchObject({ delivered_seq: 5, read_seq: 4 });
  });
});

describe("chat reducer: load races", () => {
  it("a history load that started before a send can't drop the newer confirmed message", () => {
    let s = loaded([row("a", 1)]);
    s = chatReducer(s, { type: "message", row: row("new", 7) }); // confirmed while a (re)load was in flight
    s = chatReducer(s, {
      type: "loaded",
      messages: [row("a", 1)], // stale snapshot taken before "new" existed
      reactions: [],
      attachments: [],
      moments: [],
      receipts: [],
      hasMoreOlder: false,
    });
    expect(orderedMessages(s).map((m) => m.id)).toEqual(["a", "new"]);
  });

  it("a stale load doesn't wipe reactions or receipts that arrived meanwhile", () => {
    let s = loaded([row("a", 1)]);
    s = chatReducer(s, {
      type: "reaction",
      op: "add",
      row: { message_id: "b", user_id: "u2", emoji: "🔥", room_id: "r", created_at: "" },
    });
    s = chatReducer(s, { type: "receipt", row: { room_id: "r", user_id: "u2", delivered_seq: 9, read_seq: 9, updated_at: "" } });
    s = chatReducer(s, {
      type: "loaded",
      messages: [row("a", 1)],
      reactions: [],
      attachments: [],
      moments: [],
      receipts: [],
      hasMoreOlder: false,
    });
    expect(s.reactions.b).toHaveLength(1);
    expect(s.receipts.u2).toMatchObject({ read_seq: 9 });
  });
});
