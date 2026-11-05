"use client";

import { publicEnv } from "@/lib/env";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, NOTE_TYPES, uploadResponseSchema, type UploadResponse } from "@/shared/chat";

export class UploadError extends Error {}

/** Client-side checks first (fast feedback); the server route and the bucket enforce them again. */
export function validateFile(file: File, opts: { note?: boolean } = {}): string | null {
  if (opts.note) {
    if (!(file.type in NOTE_TYPES)) return "This browser recorded a format DUO can't store.";
  } else if (!(file.type in ALLOWED_UPLOAD_TYPES))
    return `${file.name || "That file"} isn't a supported type (images, PDF, text, ZIP, Office).`;
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is larger than 25 MB.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

export async function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const bmp = await createImageBitmap(file);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    return null;
  }
}

async function requestUpload(slug: string, file: File): Promise<UploadResponse> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(slug)}/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: file.name, mimeType: file.type, size: file.size }),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : "Upload failed.";
    throw new UploadError(msg);
  }
  const parsed = uploadResponseSchema.safeParse(body);
  if (!parsed.success) throw new UploadError("Upload failed.");
  return parsed.data;
}

/**
 * Upload with progress: XHR PUT to the signed upload URL (same request storage-js makes,
 * but XHR exposes upload progress events, fetch doesn't).
 */
export async function uploadFile(slug: string, file: File, onProgress: (fraction: number) => void, signal?: AbortSignal) {
  const target = await requestUpload(slug, file);
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.signedUrl);
    xhr.setRequestHeader("apikey", publicEnv().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("content-type", file.type);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadError("The upload was rejected.")));
    xhr.onerror = () => reject(new UploadError("Network error while uploading."));
    xhr.onabort = () => reject(new UploadError("Upload cancelled."));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
  onProgress(1);
  return target;
}
