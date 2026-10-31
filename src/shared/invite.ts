import { z } from "zod";

/** 128-bit base64url token (22 chars). Same shape for room slugs and invite codes. */
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/, "Invalid code");

/**
 * Invite codes travel in the URL *fragment* (`/join#<code>`), which browsers never send
 * to servers, proxies or analytics, so the secret stays out of logs and Referer headers.
 */
export function buildInviteUrl(siteUrl: string, code: string): string {
  return `${siteUrl.replace(/\/$/, "")}/join#${code}`;
}

/** Accepts a bare code or any pasted invite link and returns the code, or null. */
export function parseInviteInput(input: string): string | null {
  const trimmed = input.trim();
  if (tokenSchema.safeParse(trimmed).success) return trimmed;
  const hashIndex = trimmed.lastIndexOf("#");
  if (hashIndex >= 0) {
    const candidate = trimmed.slice(hashIndex + 1);
    if (tokenSchema.safeParse(candidate).success) return candidate;
  }
  return null;
}

/** Only allow same-site relative redirects (blocks `//evil.com`, `/\evil.com`, absolute URLs). */
export function safeNextPath(next: string | null | undefined, fallback = "/home"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}
