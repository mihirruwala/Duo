import type { ListItemRow } from "@/shared/database";

export const MAX_LIST_TITLE = 80;
export const MAX_ITEM_LENGTH = 500;

export const LIST_EMOJIS = [
  "📝",
  "🎬",
  "🍿",
  "📍",
  "✈️",
  "💡",
  "🛒",
  "🎁",
  "📚",
  "🍽️",
  "🎵",
  "🏡",
  "💪",
  "🎮",
  "❤️",
  "⭐",
] as const;

/** One-tap starting points for an empty room. */
export const LIST_TEMPLATES = [
  { emoji: "🎬", title: "Movies to watch" },
  { emoji: "📍", title: "Places to go" },
  { emoji: "💡", title: "Date ideas" },
  { emoji: "🛒", title: "Shopping" },
  { emoji: "🎁", title: "Gift ideas" },
] as const;

/** Open items first (oldest at the top, like a queue), then done items (most recently done first). */
export function sortItems(items: ListItemRow[]): ListItemRow[] {
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done) return (b.done_at ?? "").localeCompare(a.done_at ?? "");
    return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  });
}
