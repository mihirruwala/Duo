import { describe, expect, it } from "vitest";
import {
  containedContentBox,
  encodePeerMessage,
  isControllableUrl,
  isKeyAllowed,
  macEditingCommand,
  MOD,
  normalizePoint,
  pageToExtensionSchema,
  parsePeerMessage,
  printable,
  toViewport,
  TokenBucket,
  virtualKeyCode,
} from "@/shared/control";

const SID = "3f2b7c1e-8a4d-4f6b-9c2e-1d5a7b9e0f12";

describe("coordinate mapping", () => {
  it("removes pillarbox bars (wide element, 16:9 video in 2:1 box)", () => {
    const box = containedContentBox({ left: 0, top: 0, width: 2000, height: 1000 }, 1600, 900)!;
    expect(box.height).toBe(1000);
    expect(box.width).toBeCloseTo(1777.78, 1);
    expect(box.left).toBeCloseTo(111.11, 1);
  });

  it("removes letterbox bars (tall element)", () => {
    const box = containedContentBox({ left: 10, top: 20, width: 800, height: 800 }, 1600, 900)!;
    expect(box.width).toBe(800);
    expect(box.height).toBe(450);
    expect(box.top).toBe(20 + 175);
  });

  it("ignores clicks on the bars and maps the content corners to 0 and 1", () => {
    const box = containedContentBox({ left: 0, top: 0, width: 800, height: 800 }, 1600, 900)!;
    expect(normalizePoint(box, 400, 100)).toBeNull(); // top bar
    expect(normalizePoint(box, 0, 175)).toEqual({ x: 0, y: 0 });
    expect(normalizePoint(box, 800, 625)).toEqual({ x: 1, y: 1 });
  });

  it("maps to target CSS pixels independent of DPR / zoom (viewport already in CSS px)", () => {
    // Same normalized point on a 1440×900 tab at 100% and at 150% zoom (CSS viewport 960×600).
    expect(toViewport({ x: 0.5, y: 0.5 }, { width: 1440, height: 900 })).toEqual({ x: 720, y: 450 });
    expect(toViewport({ x: 0.5, y: 0.5 }, { width: 960, height: 600 })).toEqual({ x: 480, y: 300 });
    expect(toViewport({ x: 1, y: 1 }, { width: 960, height: 600 })).toEqual({ x: 959, y: 599 });
  });

  it("returns null for a video that hasn't loaded", () => {
    expect(containedContentBox({ left: 0, top: 0, width: 100, height: 100 }, 0, 0)).toBeNull();
  });
});

describe("keyboard", () => {
  it("allows typing and editing shortcuts", () => {
    expect(isKeyAllowed("a", 0).ok).toBe(true);
    expect(isKeyAllowed("Enter", 0).ok).toBe(true);
    expect(isKeyAllowed("a", MOD.meta).ok).toBe(true);
    expect(isKeyAllowed("z", MOD.ctrl | MOD.shift).ok).toBe(true);
    expect(isKeyAllowed("ArrowLeft", MOD.meta | MOD.shift).ok).toBe(true);
    expect(isKeyAllowed("i", MOD.meta).ok).toBe(true); // italic
  });

  it.each([
    ["w", MOD.meta],
    ["t", MOD.ctrl],
    ["n", MOD.ctrl],
    ["q", MOD.meta],
    ["l", MOD.ctrl],
    ["i", MOD.meta | MOD.alt], // DevTools (mac)
    ["i", MOD.ctrl | MOD.shift], // DevTools (win/linux)
    ["c", MOD.ctrl | MOD.shift], // element inspector
    ["j", MOD.ctrl | MOD.shift],
    ["p", MOD.ctrl],
    ["s", MOD.meta],
    ["Tab", MOD.ctrl],
    ["1", MOD.meta],
    ["F12", 0],
    ["F11", 0],
    ["F4", MOD.alt],
  ])("blocks %s with mods %i", (key, mods) => {
    expect(isKeyAllowed(key, mods).ok).toBe(false);
  });

  it("refuses paste so the controller can't read the owner's clipboard", () => {
    expect(isKeyAllowed("v", MOD.meta)).toEqual({ ok: false, reason: "paste_blocked" });
    expect(isKeyAllowed("V", MOD.ctrl | MOD.shift)).toEqual({ ok: false, reason: "paste_blocked" });
  });

  it("maps virtual key codes", () => {
    expect(virtualKeyCode("a", "KeyA")).toBe(65);
    expect(virtualKeyCode("A", "KeyA")).toBe(65);
    expect(virtualKeyCode("1", "Digit1")).toBe(49);
    expect(virtualKeyCode("Enter", "Enter")).toBe(13);
    expect(virtualKeyCode("ArrowDown", "ArrowDown")).toBe(40);
    expect(virtualKeyCode(";", "Semicolon")).toBe(186);
    expect(virtualKeyCode("F5", "F5")).toBe(116);
    expect(virtualKeyCode("é", "")).toBe(0);
  });

  it("mac editing commands and printable detection", () => {
    expect(macEditingCommand("a", MOD.meta)).toBe("selectAll");
    expect(macEditingCommand("z", MOD.meta | MOD.shift)).toBe("redo");
    expect(macEditingCommand("a", MOD.ctrl)).toBeUndefined();
    expect(printable("é", 0)).toBe(true);
    expect(printable("👍", 0)).toBe(true);
    expect(printable("a", MOD.ctrl)).toBe(false);
    expect(printable("ArrowLeft", 0)).toBe(false);
  });
});

describe("URL policy", () => {
  const duo = ["http://localhost:3000", "https://duo.example"];
  it.each([
    ["https://example.com/page", true],
    ["http://localhost:4555/target", true],
    ["chrome://settings", false],
    ["chrome-extension://abc/popup.html", false],
    ["devtools://devtools/bundled/inspector.html", false],
    ["file:///etc/passwd", false],
    ["https://chromewebstore.google.com/detail/x", false],
    ["https://chrome.google.com/webstore/detail/x", false],
    ["https://duo.example/r/abc", false],
    ["http://localhost:3000/home", false],
    ["javascript:alert(1)", false],
    [undefined, false],
  ])("%s → %s", (url, ok) => expect(isControllableUrl(url, duo).ok).toBe(ok));
});

describe("message validation", () => {
  it("round-trips a valid input message", () => {
    const m = { v: 1 as const, t: "input" as const, sessionId: SID, seq: 4, e: { t: "move" as const, x: 0.5, y: 0.25 } };
    expect(parsePeerMessage(encodePeerMessage(m))).toEqual(m);
  });

  it.each([
    ["out-of-range coordinate", { v: 1, t: "input", sessionId: SID, seq: 1, e: { t: "move", x: 1.5, y: 0 } }],
    ["unknown event", { v: 1, t: "input", sessionId: SID, seq: 1, e: { t: "eval", code: "x" } }],
    ["bad session id", { v: 1, t: "input", sessionId: "nope", seq: 1, e: { t: "move", x: 0, y: 0 } }],
    ["huge wheel delta", { v: 1, t: "input", sessionId: SID, seq: 1, e: { t: "wheel", x: 0, y: 0, dx: 0, dy: 1e9 } }],
    [
      "long key",
      { v: 1, t: "input", sessionId: SID, seq: 1, e: { t: "key", phase: "down", key: "x".repeat(100), code: "", mods: 0 } },
    ],
    ["wrong version", { v: 2, t: "request", sessionId: SID }],
  ])("rejects %s", (_, raw) => {
    expect(parsePeerMessage(new TextEncoder().encode(JSON.stringify(raw)))).toBeNull();
  });

  it("rejects non-JSON and oversize payloads", () => {
    expect(parsePeerMessage(new TextEncoder().encode("{oops"))).toBeNull();
    expect(parsePeerMessage(new Uint8Array(5000))).toBeNull();
  });

  it("validates page → extension messages", () => {
    expect(
      pageToExtensionSchema.safeParse({ type: "control.start", sessionId: SID, controllerName: "Gabe", expiresAt: 1 }).success,
    ).toBe(true);
    expect(
      pageToExtensionSchema.safeParse({ type: "control.start", sessionId: SID, controllerName: "", expiresAt: 1 }).success,
    ).toBe(false);
    expect(pageToExtensionSchema.safeParse({ type: "debugger.sendCommand", method: "Runtime.evaluate" }).success).toBe(false);
  });
});

describe("rate limiting", () => {
  it("allows a burst then throttles to the sustained rate", () => {
    let t = 0;
    const bucket = new TokenBucket(10, 20, () => t);
    let allowed = 0;
    for (let i = 0; i < 50; i++) if (bucket.take()) allowed++;
    expect(allowed).toBe(20);
    t += 1000;
    allowed = 0;
    for (let i = 0; i < 50; i++) if (bucket.take()) allowed++;
    expect(allowed).toBe(10);
  });
});
