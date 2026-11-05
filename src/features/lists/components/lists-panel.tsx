"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useChat } from "@/features/chat/chat-provider";
import { Linkified } from "@/features/chat/linkify";
import { requestWatch, useCallOpen } from "@/features/call/watch/watch-events";
import type { ListItemRow, ListRow } from "@/shared/database";
import { findYouTube } from "@/shared/watch";
import { LIST_EMOJIS, LIST_TEMPLATES, MAX_ITEM_LENGTH, MAX_LIST_TITLE } from "../lists";
import { useLists } from "../lists-provider";

/** The "Lists" tab of the chat dock: every list in the room, or one list opened. */
export function ListsPanel() {
  const lists = useLists();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? lists.lists.find((l) => l.id === openId) : undefined;

  if (!lists.loaded) {
    return (
      <div className="grid flex-1 place-items-center text-muted-foreground" role="status">
        {lists.error ?? <Loader2 className="size-5 animate-spin" aria-label="Loading lists" />}
      </div>
    );
  }
  if (open) return <ListDetail list={open} onBack={() => setOpenId(null)} />;
  return <ListIndex onOpen={setOpenId} />;
}

function ListIndex({ onOpen }: { onOpen: (id: string) => void }) {
  const lists = useLists();
  const [creating, setCreating] = useState(false);

  async function create(title: string, emoji: string) {
    const r = await lists.createList(title, emoji);
    if ("error" in r) return void toast.error(r.error);
    setCreating(false);
    onOpen(r.id);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="lists-index">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h2 className="text-sm font-bold">Shared lists</h2>
        {!creating && (
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
            <Plus /> New list
          </Button>
        )}
      </div>
      {creating && <NewListForm onCreate={create} onCancel={() => setCreating(false)} />}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {lists.lists.length === 0 && !creating ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <span className="grid size-14 place-items-center rounded-3xl bg-ink-3 text-coral">
              <ListChecks className="size-7" aria-hidden />
            </span>
            <p className="font-bold">Lists you both can edit</p>
            <p className="text-sm text-muted-foreground">
              Films to watch, places to go, things to buy. Tick things off together; changes show up for both of you instantly.
            </p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              {LIST_TEMPLATES.map((t) => (
                <button
                  key={t.title}
                  type="button"
                  onClick={() => void create(t.title, t.emoji)}
                  className="rounded-full bg-ink-3 px-3 py-1.5 text-sm font-semibold hover:bg-ink-4"
                >
                  {t.emoji} {t.title}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {lists.lists.map((l) => (
              <li key={l.id}>
                <ListCard list={l} items={lists.itemsOf(l.id)} onOpen={() => onOpen(l.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ListCard({ list, items, onOpen }: { list: ListRow; items: ListItemRow[]; onOpen: () => void }) {
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="list-card"
      className="flex w-full items-center gap-3 rounded-2xl bg-ink-2 p-3 text-left ring-1 ring-white/6 transition-colors hover:bg-ink-3"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink-3 text-xl" aria-hidden>
        {list.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{list.title}</span>
        <span className="block text-xs text-muted-foreground">
          {total === 0 ? "Empty" : done === total ? `All ${total} done 🎉` : `${total - done} to go · ${done} done`}
        </span>
        {total > 0 && (
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-ink-4" aria-hidden>
            <span className="block h-full rounded-full bg-mint" style={{ width: `${(done / total) * 100}%` }} />
          </span>
        )}
      </span>
    </button>
  );
}

function EmojiPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`List icon: ${value}. Change`}
        className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink-3 text-xl hover:bg-ink-4"
      >
        {value}
      </PopoverTrigger>
      <PopoverContent className="grid w-auto grid-cols-8 gap-1 rounded-2xl p-1.5" align="start">
        {LIST_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            aria-label={e}
            onClick={() => {
              onChange(e);
              setOpen(false);
            }}
            className={cn("grid size-9 place-items-center rounded-lg text-xl hover:bg-ink-3", e === value && "bg-ink-3")}
          >
            {e}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function NewListForm({
  onCreate,
  onCancel,
}: {
  onCreate: (title: string, emoji: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState<string>(LIST_EMOJIS[0]);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mx-3 mb-2 flex items-center gap-2 rounded-2xl bg-ink-2 p-2 ring-1 ring-white/6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim() || busy) return;
        setBusy(true);
        await onCreate(title, emoji);
        setBusy(false);
      }}
    >
      <EmojiPicker value={emoji} onChange={setEmoji} />
      <Input
        autoFocus
        value={title}
        maxLength={MAX_LIST_TITLE}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        placeholder="List name"
        aria-label="List name"
        className="h-10"
      />
      <Button type="submit" size="icon" disabled={!title.trim() || busy} aria-label="Create list">
        {busy ? <Loader2 className="animate-spin" /> : <Check />}
      </Button>
      <Button type="button" size="icon" variant="ghost" onClick={onCancel} aria-label="Cancel">
        <X />
      </Button>
    </form>
  );
}

function ListDetail({ list, onBack }: { list: ListRow; onBack: () => void }) {
  const lists = useLists();
  const items = lists.itemsOf(list.id);
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(list.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showDone, setShowDone] = useState(true);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const err = await lists.addItem(list.id, text);
    if (err) {
      toast.error(err);
      setDraft(text);
    }
  }

  async function saveTitle() {
    setRenaming(false);
    if (title.trim() === list.title) return;
    const err = await lists.updateList(list.id, { title });
    if (err) {
      toast.error(err);
      setTitle(list.title);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="list-detail">
      <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
        <Button size="icon-sm" variant="ghost" onClick={onBack} aria-label="All lists">
          <ChevronLeft />
        </Button>
        <EmojiPicker
          value={list.emoji}
          onChange={(emoji) => void lists.updateList(list.id, { emoji }).then((err) => err && toast.error(err))}
        />
        {renaming ? (
          <Input
            autoFocus
            value={title}
            maxLength={MAX_LIST_TITLE}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveTitle();
              if (e.key === "Escape") {
                setTitle(list.title);
                setRenaming(false);
              }
            }}
            aria-label="List name"
            className="h-9"
          />
        ) : (
          <h2 className="min-w-0 flex-1 truncate font-bold" data-testid="list-title">
            {list.title}
          </h2>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="List options"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-ink-3 hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setTitle(list.title);
                setRenaming(true);
              }}
            >
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-danger focus:text-danger">
              <Trash2 /> Delete list
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {confirmDelete && (
        <div
          role="alert"
          className="mx-3 mb-2 flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 p-2.5 text-sm"
        >
          <span className="flex-1">
            Delete “{list.title}” and its {items.length} items for both of you?
          </span>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
            Keep
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              const err = await lists.deleteList(list.id);
              if (err) toast.error(err);
              else onBack();
            }}
          >
            Delete
          </Button>
        </div>
      )}

      <form onSubmit={(e) => void add(e)} className="mx-3 mb-2 flex gap-2">
        <Input
          value={draft}
          maxLength={MAX_ITEM_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Add to ${list.title}…`}
          aria-label="New item"
          data-testid="list-add-input"
          className="h-10"
        />
        <Button type="submit" size="icon" disabled={!draft.trim()} aria-label="Add item">
          <Plus />
        </Button>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {items.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing here yet. Tip: paste a YouTube link and you can start it in a call with one tap.
          </p>
        )}
        <ul className="flex flex-col" aria-label="To do">
          {open.map((i) => (
            <ItemRow key={i.id} item={i} />
          ))}
        </ul>
        {done.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowDone((s) => !s)}
              aria-expanded={showDone}
              className="mt-3 flex items-center gap-1 px-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn("size-3.5 transition-transform", !showDone && "-rotate-90")} aria-hidden /> Done (
              {done.length})
            </button>
            {showDone && (
              <ul className="flex flex-col" aria-label="Done">
                {done.map((i) => (
                  <ItemRow key={i.id} item={i} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ItemRow({ item }: { item: ListItemRow }) {
  const lists = useLists();
  const chat = useChat();
  const callOpen = useCallOpen();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.body);
  const yt = findYouTube(item.body);
  const adder = item.created_by ? chat.people[item.created_by] : undefined;
  const doneBy = item.done_by ? chat.people[item.done_by] : undefined;
  const byMe = (id: string | null) => id === chat.me.id;

  async function save() {
    setEditing(false);
    if (draft.trim() === item.body) return;
    const err = await lists.editItem(item.id, draft);
    if (err) {
      toast.error(err);
      setDraft(item.body);
    }
  }

  return (
    <li
      className="group/item flex items-start gap-2.5 rounded-xl px-2 py-1.5 hover:bg-ink-2"
      data-testid="list-item"
      data-done={item.done ? "" : undefined}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        aria-label={item.done ? `Mark “${item.body}” as not done` : `Mark “${item.body}” as done`}
        onClick={() => void lists.setDone(item.id, !item.done).then((err) => err && toast.error(err))}
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors",
          item.done ? "border-mint bg-mint text-ink-0" : "border-ink-4 hover:border-mint",
        )}
      >
        {item.done && <Check className="size-3" strokeWidth={3} aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            autoFocus
            value={draft}
            maxLength={MAX_ITEM_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") {
                setDraft(item.body);
                setEditing(false);
              }
            }}
            aria-label="Edit item"
            className="h-8"
          />
        ) : (
          <p className={cn("text-sm break-words", item.done && "text-muted-foreground line-through")}>
            <Linkified text={item.body} />
          </p>
        )}
        <p className="text-[0.7rem] text-muted-foreground">
          {item.done && doneBy
            ? `Done by ${byMe(item.done_by) ? "you" : doneBy.name}`
            : adder
              ? `Added by ${byMe(item.created_by) ? "you" : adder.name}`
              : null}
        </p>
      </div>
      {yt && callOpen && !item.done && (
        <Button
          size="xs"
          variant="ghost"
          className="text-coral"
          onClick={() => requestWatch(yt)}
          aria-label={`Watch “${item.body}” together now`}
        >
          <Play /> Watch
        </Button>
      )}
      <span className="flex opacity-0 transition-opacity group-focus-within/item:opacity-100 group-hover/item:opacity-100 [@media(hover:none)]:opacity-100">
        {!item.done && (
          <button
            type="button"
            onClick={() => {
              setDraft(item.body);
              setEditing(true);
            }}
            aria-label={`Edit “${item.body}”`}
            className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-ink-3 hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => void lists.deleteItem(item.id).then((err) => err && toast.error(err))}
          aria-label={`Delete “${item.body}”`}
          className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-ink-3 hover:text-danger"
        >
          <Trash2 className="size-3.5" />
        </button>
      </span>
    </li>
  );
}
