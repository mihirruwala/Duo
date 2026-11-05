"use client";

import { createContext, use, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import type { ListItemRow, ListRow } from "@/shared/database";
import { friendlyError } from "@/shared/errors";
import { useChat } from "@/features/chat/chat-provider";
import { MAX_ITEM_LENGTH, MAX_LIST_TITLE, sortItems } from "./lists";

type State = { loaded: boolean; error: string | null; lists: Record<string, ListRow>; items: Record<string, ListItemRow> };

type Action =
  | { type: "loaded"; lists: ListRow[]; items: ListItemRow[] }
  | { type: "error"; error: string }
  | { type: "list"; row: ListRow }
  | { type: "list-remove"; id: string }
  | { type: "item"; row: ListItemRow }
  | { type: "item-remove"; id: string };

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case "loaded":
      return {
        loaded: true,
        error: null,
        lists: Object.fromEntries(a.lists.map((l) => [l.id, l])),
        items: Object.fromEntries(a.items.map((i) => [i.id, i])),
      };
    case "error":
      return { ...state, error: a.error };
    case "list":
      return { ...state, lists: { ...state.lists, [a.row.id]: a.row } };
    case "list-remove": {
      const lists = { ...state.lists };
      delete lists[a.id];
      const items = Object.fromEntries(Object.entries(state.items).filter(([, i]) => i.list_id !== a.id));
      return { ...state, lists, items };
    }
    case "item":
      // An item for a list we don't know (deleted meanwhile) is dropped.
      if (!state.lists[a.row.list_id]) return state;
      return { ...state, items: { ...state.items, [a.row.id]: a.row } };
    case "item-remove": {
      if (!state.items[a.id]) return state;
      const items = { ...state.items };
      delete items[a.id];
      return { ...state, items };
    }
  }
}

type ListsApi = {
  loaded: boolean;
  error: string | null;
  /** Oldest first. */
  lists: ListRow[];
  /** Every item in the room (open first, then done), for cross-list features like Watch Together. */
  items: ListItemRow[];
  itemsOf: (listId: string) => ListItemRow[];
  createList: (title: string, emoji: string) => Promise<{ id: string } | { error: string }>;
  updateList: (id: string, patch: { title?: string; emoji?: string }) => Promise<string | null>;
  deleteList: (id: string) => Promise<string | null>;
  addItem: (listId: string, body: string) => Promise<string | null>;
  setDone: (id: string, done: boolean) => Promise<string | null>;
  editItem: (id: string, body: string) => Promise<string | null>;
  deleteItem: (id: string) => Promise<string | null>;
};

const ListsContext = createContext<ListsApi | null>(null);

export function useLists(): ListsApi {
  const ctx = use(ListsContext);
  if (!ctx) throw new Error("useLists must be used inside <ListsProvider>");
  return ctx;
}

export function useMaybeLists(): ListsApi | null {
  return use(ListsContext);
}

const db = () => getBrowserClient();

/**
 * The room's shared lists. Writes are optimistic (applied here first, rolled back if the database
 * says no); the other person's changes arrive through the chat provider's private room channel.
 */
export function ListsProvider({ roomId, children }: { roomId: string; children: React.ReactNode }) {
  const chat = useChat();
  const [state, dispatch] = useReducer(reducer, { loaded: false, error: null, lists: {}, items: {} });
  // Latest state for async callbacks (synced after each commit, never during render).
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });

  const load = useCallback(async () => {
    const [l, i] = await Promise.all([
      db().from("lists").select("*").eq("room_id", roomId).order("created_at").limit(100),
      db().from("list_items").select("*").eq("room_id", roomId).order("created_at").limit(10000),
    ]);
    if (l.error || i.error)
      return dispatch({ type: "error", error: friendlyError(l.error ?? i.error, "Couldn't load your lists.") });
    dispatch({ type: "loaded", lists: l.data, items: i.data });
  }, [roomId]);

  const { onRoomChange, connected } = chat;

  // Load on connect, and again after a reconnect (changes may have been missed while offline).
  useEffect(() => {
    if (!connected) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [connected, load]);

  useEffect(
    () =>
      onRoomChange((table, op, record, old) => {
        if (table === "lists") {
          if (op === "DELETE" && old?.id) dispatch({ type: "list-remove", id: String(old.id) });
          else if (record) dispatch({ type: "list", row: record as unknown as ListRow });
        } else if (table === "list_items") {
          if (op === "DELETE" && old?.id) dispatch({ type: "item-remove", id: String(old.id) });
          else if (record) dispatch({ type: "item", row: record as unknown as ListItemRow });
        }
      }),
    [onRoomChange],
  );

  const me = chat.me.id;

  const createList = useCallback(
    async (title: string, emoji: string): Promise<{ id: string } | { error: string }> => {
      const t = title.trim().slice(0, MAX_LIST_TITLE);
      if (!t) return { error: "Give the list a name." };
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      dispatch({ type: "list", row: { id, room_id: roomId, title: t, emoji, created_by: me, created_at: now, updated_at: now } });
      const { data, error } = await db().from("lists").insert({ id, room_id: roomId, title: t, emoji }).select("*").single();
      if (error || !data) {
        dispatch({ type: "list-remove", id });
        return { error: friendlyError(error, "Couldn't create the list.") };
      }
      dispatch({ type: "list", row: data });
      return { id };
    },
    [roomId, me],
  );

  const updateList = useCallback(async (id: string, patch: { title?: string; emoji?: string }) => {
    const before = stateRef.current.lists[id];
    if (!before) return "That list is gone.";
    const next = { ...patch, ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, MAX_LIST_TITLE) } : {}) };
    if (next.title === "") return "A list needs a name.";
    dispatch({ type: "list", row: { ...before, ...next } });
    const { data, error } = await db().from("lists").update(next).eq("id", id).select("*").single();
    if (error || !data) {
      dispatch({ type: "list", row: before });
      return friendlyError(error);
    }
    dispatch({ type: "list", row: data });
    return null;
  }, []);

  const deleteList = useCallback(async (id: string) => {
    const before = stateRef.current;
    const list = before.lists[id];
    if (!list) return null;
    const items = Object.values(before.items).filter((i) => i.list_id === id);
    dispatch({ type: "list-remove", id });
    const { error } = await db().from("lists").delete().eq("id", id);
    if (error) {
      dispatch({ type: "list", row: list });
      items.forEach((row) => dispatch({ type: "item", row }));
      return friendlyError(error);
    }
    return null;
  }, []);

  const addItem = useCallback(
    async (listId: string, body: string) => {
      const text = body.trim().slice(0, MAX_ITEM_LENGTH);
      if (!text) return null;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      dispatch({
        type: "item",
        row: {
          id,
          list_id: listId,
          room_id: roomId,
          body: text,
          done: false,
          done_by: null,
          done_at: null,
          created_by: me,
          created_at: now,
          updated_at: now,
        },
      });
      const { data, error } = await db().from("list_items").insert({ id, list_id: listId, body: text }).select("*").single();
      if (error || !data) {
        dispatch({ type: "item-remove", id });
        return friendlyError(error, "Couldn't add that.");
      }
      dispatch({ type: "item", row: data });
      return null;
    },
    [roomId, me],
  );

  const patchItem = useCallback(
    async (id: string, patch: { body?: string; done?: boolean }, optimistic: Partial<ListItemRow>) => {
      const before = stateRef.current.items[id];
      if (!before) return "That item is gone.";
      dispatch({ type: "item", row: { ...before, ...optimistic } });
      const { data, error } = await db().from("list_items").update(patch).eq("id", id).select("*").single();
      if (error || !data) {
        dispatch({ type: "item", row: before });
        return friendlyError(error);
      }
      dispatch({ type: "item", row: data });
      return null;
    },
    [],
  );

  const setDone = useCallback(
    (id: string, done: boolean) =>
      patchItem(id, { done }, { done, done_by: done ? me : null, done_at: done ? new Date().toISOString() : null }),
    [patchItem, me],
  );

  const editItem = useCallback(
    async (id: string, body: string) => {
      const text = body.trim().slice(0, MAX_ITEM_LENGTH);
      if (!text) return "An item can't be empty.";
      return patchItem(id, { body: text }, { body: text });
    },
    [patchItem],
  );

  const deleteItem = useCallback(async (id: string) => {
    const before = stateRef.current.items[id];
    if (!before) return null;
    dispatch({ type: "item-remove", id });
    const { error } = await db().from("list_items").delete().eq("id", id);
    if (error) {
      dispatch({ type: "item", row: before });
      return friendlyError(error);
    }
    return null;
  }, []);

  const api = useMemo<ListsApi>(() => {
    const lists = Object.values(state.lists).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const all = sortItems(Object.values(state.items));
    const byList = new Map<string, ListItemRow[]>();
    for (const item of all) {
      const arr = byList.get(item.list_id);
      if (arr) arr.push(item);
      else byList.set(item.list_id, [item]);
    }
    return {
      loaded: state.loaded,
      error: state.error,
      lists,
      items: all,
      itemsOf: (listId) => byList.get(listId) ?? [],
      createList,
      updateList,
      deleteList,
      addItem,
      setDone,
      editItem,
      deleteItem,
    };
  }, [state, createList, updateList, deleteList, addItem, setDone, editItem, deleteItem]);

  return <ListsContext value={api}>{children}</ListsContext>;
}
