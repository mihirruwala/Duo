import { z } from "zod";

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Allowed uploads. Mirrors the storage bucket + attachments CHECK constraint. No SVG/HTML (script risk). */
export const ALLOWED_UPLOAD_TYPES: Record<string, { kind: "image" | "file"; label: string }> = {
  "image/png": { kind: "image", label: "PNG" },
  "image/jpeg": { kind: "image", label: "JPEG" },
  "image/webp": { kind: "image", label: "WebP" },
  "image/gif": { kind: "image", label: "GIF" },
  "application/pdf": { kind: "file", label: "PDF" },
  "text/plain": { kind: "file", label: "Text" },
  "application/zip": { kind: "file", label: "ZIP" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { kind: "file", label: "Word" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { kind: "file", label: "Excel" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { kind: "file", label: "PowerPoint" },
};

export const UPLOAD_ACCEPT = Object.keys(ALLOWED_UPLOAD_TYPES).join(",");

/**
 * Make a user-supplied file name safe to store and display: strip paths and control chars,
 * collapse whitespace, keep a short extension, cap the length. Never empty.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
  if (!cleaned) return "file";
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 120 - ext.length) + ext;
}

export const uploadRequestSchema = z.object({
  fileName: z.string().min(1).max(500),
  mimeType: z.string().refine((t) => t in ALLOWED_UPLOAD_TYPES, "That file type isn't allowed."),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES, "Files can be up to 25 MB."),
});
export type UploadRequest = z.infer<typeof uploadRequestSchema>;

export const uploadResponseSchema = z.object({
  path: z.string(),
  signedUrl: z.url(),
  fileName: z.string(),
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

// ── GIFs ────────────────────────────────────────────────────────────────────

export const GIPHY_MEDIA = /^https:\/\/media[0-9]*\.giphy\.com\//;

export const gifSchema = z.object({
  id: z.string().max(64),
  title: z.string().max(200),
  url: z.string().regex(GIPHY_MEDIA),
  preview: z.string().regex(GIPHY_MEDIA),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Gif = z.infer<typeof gifSchema>;
export const gifSearchResponseSchema = z.object({ gifs: z.array(gifSchema), nextOffset: z.number().int().nullable() });

// ── Message meta (validated whenever we read rows) ──────────────────────────

export const gifMetaSchema = z.object({
  giphy_id: z.string(),
  url: z.string().regex(GIPHY_MEDIA),
  width: z.number().optional(),
  height: z.number().optional(),
  title: z.string().optional(),
});
export const stickerMetaSchema = z.object({ sticker_id: z.string().regex(/^[a-z0-9-]{1,40}$/) });
export const attachmentMetaSchema = z.object({
  file_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
});

// ── Stickers (original artwork in /public/stickers) ─────────────────────────

export const STICKERS = [
  { id: "duo-hug", label: "Two blobs hugging" },
  { id: "heart-eyes", label: "Heart with sparkly eyes" },
  { id: "coffee-buddy", label: "Smiling coffee cup" },
  { id: "sleepy-moon", label: "Sleepy moon" },
  { id: "party-star", label: "Star with party hat" },
  { id: "lol-bubble", label: "LOL speech bubble" },
  { id: "shy-ghost", label: "Shy little ghost" },
  { id: "thumbs-blob", label: "Blob giving a thumbs up" },
  { id: "pizza-slice", label: "Happy pizza slice" },
  { id: "cactus-wave", label: "Cactus waving hello" },
  { id: "rain-cloud", label: "Grumpy rain cloud" },
  { id: "sparkle-cat", label: "Cat surrounded by sparkles" },
] as const;
export type StickerId = (typeof STICKERS)[number]["id"];
export const isStickerId = (id: string): id is StickerId => STICKERS.some((s) => s.id === id);

// ── Reactions ───────────────────────────────────────────────────────────────

export const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "👍"] as const;
export const MORE_REACTIONS = [
  "😍",
  "🥹",
  "😭",
  "🤣",
  "😅",
  "🙃",
  "😎",
  "🤔",
  "😴",
  "🤯",
  "🥳",
  "😤",
  "👀",
  "🙌",
  "👏",
  "🙏",
  "💪",
  "✨",
  "💯",
  "🎉",
  "💀",
  "🫶",
  "👋",
  "✅",
] as const;
