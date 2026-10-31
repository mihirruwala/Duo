/**
 * Remote-control protocol, shared by the DUO page (both roles) and the Chrome extension.
 * Everything here is pure and unit-tested. See docs/ARCHITECTURE.md §4.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const CONTROL_TOPIC = "duo.ctl";
/** LiveKit track name for a tab shared through the extension (the only kind that can be controlled). */
export const CONTROLLABLE_TRACK_NAME = "duo-controllable-tab";
/** Hard cap the extension applies regardless of what the page asks for. */
export const MAX_SESSION_MS = 60 * 60 * 1000;
export const EMERGENCY_SHORTCUT = { mac: "⌘⇧9", other: "Ctrl+Shift+9" } as const;

const sessionId = z.uuid();
const unit = z.number().min(0).max(1);
const seq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

// ── Input events (controller → owner → extension) ────────────────────────────

export const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;

export const inputEventSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("move"), x: unit, y: unit }),
  z.object({
    t: z.literal("button"),
    x: unit,
    y: unit,
    button: z.enum(["left", "middle", "right"]),
    down: z.boolean(),
    clicks: z.number().int().min(1).max(3),
    mods: z.number().int().min(0).max(15),
  }),
  z.object({
    t: z.literal("wheel"),
    x: unit,
    y: unit,
    dx: z.number().min(-2000).max(2000),
    dy: z.number().min(-2000).max(2000),
  }),
  z.object({
    t: z.literal("key"),
    phase: z.enum(["down", "up"]),
    key: z.string().min(1).max(24),
    code: z.string().max(24),
    mods: z.number().int().min(0).max(15),
  }),
  z.object({ t: z.literal("nav"), action: z.enum(["back", "forward", "reload"]) }),
]);
export type InputEvent = z.infer<typeof inputEventSchema>;

// ── LiveKit data messages between the two people ────────────────────────────

export const peerMessageSchema = z.discriminatedUnion("t", [
  z.object({ v: z.literal(PROTOCOL_VERSION), t: z.literal("request"), sessionId }),
  z.object({ v: z.literal(PROTOCOL_VERSION), t: z.literal("approve"), sessionId, expiresAt: z.number().int() }),
  z.object({ v: z.literal(PROTOCOL_VERSION), t: z.literal("deny"), sessionId }),
  z.object({ v: z.literal(PROTOCOL_VERSION), t: z.literal("end"), sessionId, reason: z.string().max(64) }),
  z.object({ v: z.literal(PROTOCOL_VERSION), t: z.literal("input"), sessionId, seq, e: inputEventSchema }),
]);
export type PeerMessage = z.infer<typeof peerMessageSchema>;

const MAX_PEER_BYTES = 2048;
export function parsePeerMessage(bytes: Uint8Array): PeerMessage | null {
  if (bytes.byteLength > MAX_PEER_BYTES) return null;
  try {
    const parsed = peerMessageSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function encodePeerMessage(m: PeerMessage): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(m));
}

// ── DUO page ↔ extension (chrome.runtime Port) ──────────────────────────────

export const pageToExtensionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), version: z.literal(PROTOCOL_VERSION) }),
  z.object({
    type: z.literal("control.start"),
    sessionId,
    controllerName: z.string().min(1).max(40),
    expiresAt: z.number().int(),
  }),
  z.object({ type: z.literal("control.stop"), sessionId, reason: z.string().max(64) }),
  z.object({ type: z.literal("input"), sessionId, seq, e: inputEventSchema }),
  z.object({ type: z.literal("share.stopped") }),
  z.object({ type: z.literal("approval.request"), sessionId, controllerName: z.string().min(1).max(40) }),
  z.object({ type: z.literal("approval.dismiss"), sessionId }),
]);
export type PageToExtension = z.infer<typeof pageToExtensionSchema>;

export const extensionToPageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello.ok"), version: z.number(), shortcut: z.string().max(32) }),
  z.object({ type: z.literal("share.ready"), streamId: z.string().min(1).max(512), tabTitle: z.string().max(200) }),
  z.object({ type: z.literal("share.cleared"), reason: z.string().max(64) }),
  z.object({ type: z.literal("control.started"), sessionId }),
  z.object({ type: z.literal("control.ended"), sessionId, reason: z.string().max(64) }),
  z.object({ type: z.literal("control.error"), sessionId, message: z.string().max(200) }),
  z.object({ type: z.literal("approval.response"), sessionId, approved: z.boolean() }),
  z.object({ type: z.literal("emergency.stop") }),
]);
export type ExtensionToPage = z.infer<typeof extensionToPageSchema>;

// ── Coordinate mapping ──────────────────────────────────────────────────────

export type Box = { left: number; top: number; width: number; height: number };

/**
 * The box the video *content* occupies inside an element rendered with object-fit: contain
 * (letterbox/pillarbox bars removed). Pointer events outside it are ignored.
 */
export function containedContentBox(element: Box, videoWidth: number, videoHeight: number): Box | null {
  if (!videoWidth || !videoHeight || !element.width || !element.height) return null;
  const videoRatio = videoWidth / videoHeight;
  const elementRatio = element.width / element.height;
  if (elementRatio > videoRatio) {
    const width = element.height * videoRatio;
    return { left: element.left + (element.width - width) / 2, top: element.top, width, height: element.height };
  }
  const height = element.width / videoRatio;
  return { left: element.left, top: element.top + (element.height - height) / 2, width: element.width, height };
}

/** Client point → normalized 0..1 inside the content box, or null when outside. */
export function normalizePoint(box: Box, clientX: number, clientY: number): { x: number; y: number } | null {
  const x = (clientX - box.left) / box.width;
  const y = (clientY - box.top) / box.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/**
 * Normalized → CSS pixels in the target tab. `viewport` is window.innerWidth/innerHeight of the
 * target (CSS px, which already accounts for zoom and DPR; tab capture frames that same area).
 */
export function toViewport(p: { x: number; y: number }, viewport: { width: number; height: number }) {
  return {
    x: Math.min(viewport.width - 1, Math.max(0, Math.round(p.x * viewport.width))),
    y: Math.min(viewport.height - 1, Math.max(0, Math.round(p.y * viewport.height))),
  };
}

// ── Keyboard ────────────────────────────────────────────────────────────────

export function modsFrom(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (e.altKey ? MOD.alt : 0) | (e.ctrlKey ? MOD.ctrl : 0) | (e.metaKey ? MOD.meta : 0) | (e.shiftKey ? MOD.shift : 0);
}

const NAMED_KEYS: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
  " ": 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
  Shift: 16,
  Control: 17,
  Alt: 18,
  Meta: 91,
  CapsLock: 20,
};
const CODE_KEYS: Record<string, number> = {
  Semicolon: 186,
  Equal: 187,
  Comma: 188,
  Minus: 189,
  Period: 190,
  Slash: 191,
  Backquote: 192,
  BracketLeft: 219,
  Backslash: 220,
  BracketRight: 221,
  Quote: 222,
  Space: 32,
};

export function virtualKeyCode(key: string, code: string): number {
  if (NAMED_KEYS[key] !== undefined) return NAMED_KEYS[key]!;
  const fn = /^F([1-9]|1[0-2])$/.exec(key);
  if (fn) return 111 + Number(fn[1]);
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  if (/^Numpad[0-9]$/.test(code)) return 96 + Number(code.slice(6));
  if (CODE_KEYS[code] !== undefined) return CODE_KEYS[code]!;
  if (key.length === 1) {
    const c = key.toUpperCase().charCodeAt(0);
    if ((c >= 65 && c <= 90) || (c >= 48 && c <= 57)) return c;
  }
  return 0;
}

/**
 * Sensible exclusions. With Ctrl/⌘ held only editing shortcuts pass (no closing tabs, devtools,
 * print/save dialogs, address bar…). Paste is refused: it would read the *owner's* clipboard.
 * F-keys other than F5 are refused (devtools, fullscreen, caret browsing).
 */
const ALLOWED_WITH_COMMAND = new Set([
  "a",
  "c",
  "x",
  "z",
  "y",
  "b",
  "i",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Backspace",
  "Delete",
  "Home",
  "End",
  "Enter",
]);

const SHIFT_OK_WITH_COMMAND = new Set(["z", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

export function isKeyAllowed(key: string, mods: number): { ok: true } | { ok: false; reason: string } {
  const command = (mods & MOD.ctrl) !== 0 || (mods & MOD.meta) !== 0;
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (/^F([1-9]|1[0-2])$/.test(key) && key !== "F5") return { ok: false, reason: "function_key" };
  if ((mods & MOD.alt) !== 0 && (key === "F4" || key === "Tab" || key === "ArrowLeft" || key === "ArrowRight")) {
    return { ok: false, reason: "browser_shortcut" };
  }
  if (!command) return { ok: true };
  if (k === "v") return { ok: false, reason: "paste_blocked" };
  // ⌘⌥I / Ctrl+Shift+I / Ctrl+Shift+J … are DevTools and other browser shortcuts.
  if ((mods & MOD.alt) !== 0) return { ok: false, reason: "browser_shortcut" };
  if ((mods & MOD.shift) !== 0 && !SHIFT_OK_WITH_COMMAND.has(k)) return { ok: false, reason: "browser_shortcut" };
  if (!ALLOWED_WITH_COMMAND.has(k)) return { ok: false, reason: "browser_shortcut" };
  return { ok: true };
}

/** macOS editing commands CDP needs for ⌘-shortcuts (the OS menu normally handles them). */
export function macEditingCommand(key: string, mods: number): string | undefined {
  if ((mods & MOD.meta) === 0) return undefined;
  const shift = (mods & MOD.shift) !== 0;
  switch (key.toLowerCase()) {
    case "a":
      return "selectAll";
    case "c":
      return "copy";
    case "x":
      return "cut";
    case "z":
      return shift ? "redo" : "undo";
    case "y":
      return "redo";
    default:
      return undefined;
  }
}

/** Does this key produce text (and should go to CDP with `text`)? */
export function printable(key: string, mods: number): boolean {
  if ((mods & (MOD.ctrl | MOD.meta)) !== 0) return false;
  return Array.from(key).length === 1 || key === "Enter";
}

// ── URL policy for the controlled tab ───────────────────────────────────────

/**
 * Only ordinary web pages can be controlled. Never chrome://, extension pages, devtools,
 * file://, the Chrome Web Store, or DUO itself (the controller could approve their own request).
 */
export function isControllableUrl(
  rawUrl: string | undefined,
  duoOrigins: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  if (!rawUrl) return { ok: false, reason: "unknown_url" };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "blocked_scheme" };
  if (duoOrigins.includes(url.origin)) return { ok: false, reason: "duo_tab" };
  if (url.hostname === "chromewebstore.google.com") return { ok: false, reason: "web_store" };
  if (url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore")) return { ok: false, reason: "web_store" };
  return { ok: true };
}

// ── Rate limiting ───────────────────────────────────────────────────────────

/** Token bucket. Defaults: 120 events/s sustained, bursts of 240. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly ratePerSec = 120,
    private readonly burst = 240,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = burst;
    this.last = now();
  }
  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.ratePerSec);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export const END_REASONS: Record<string, string> = {
  owner_revoked: "Control was revoked.",
  emergency_stop: "Control stopped with the emergency shortcut.",
  expired: "The control session timed out.",
  released: "Control was handed back.",
  share_stopped: "Screen sharing stopped.",
  tab_closed: "The shared tab was closed.",
  blocked_url: "The shared tab moved to a page that can't be controlled.",
  debugger_detached: "Chrome's debugging bar was closed, so control ended.",
  extension_disconnected: "The DUO extension disconnected.",
  peer_left: "The other person left the call.",
  denied: "The request was declined.",
  superseded: "A newer control request replaced this one.",
};
export function endReasonText(reason: string): string {
  return END_REASONS[reason] ?? "Control ended.";
}
