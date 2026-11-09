import { describe, expect, it } from "vitest";
import { extensionToPageSchema, pageToExtensionSchema } from "@/shared/control";
import { cleanTitle, encodeTabSync, parseTabSync, seekNeedsPlayerApi, tabLabel } from "@/shared/tab-sync";

describe("tab sync messages", () => {
  it("round-trips valid messages", () => {
    for (const m of [
      { v: 1, t: "linked", tab: { title: "Dark S1E1", host: "www.netflix.com" } },
      { v: 1, t: "unlinked" },
      { v: 1, t: "state", at: 61.5, playing: true, hb: true },
      { v: 1, t: "hello" },
    ] as const) {
      expect(parseTabSync(encodeTabSync(m))).toEqual(m);
    }
  });

  it("rejects bad or oversized input", () => {
    const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
    expect(parseTabSync(enc({ v: 1, t: "state", at: -1, playing: true }))).toBeNull();
    expect(parseTabSync(enc({ v: 1, t: "state", at: Number.MAX_VALUE, playing: true }))).toBeNull();
    expect(parseTabSync(enc({ v: 1, t: "linked", tab: { title: "x".repeat(121), host: "a" } }))).toBeNull();
    expect(parseTabSync(enc({ v: 2, t: "hello" }))).toBeNull();
    expect(parseTabSync(new Uint8Array(600))).toBeNull();
    expect(parseTabSync(new TextEncoder().encode("{nope"))).toBeNull();
  });

  it("extension protocol accepts the sync messages and old hello.ok without features", () => {
    expect(pageToExtensionSchema.safeParse({ type: "sync.remote", state: { at: 3, playing: false } }).success).toBe(true);
    expect(pageToExtensionSchema.safeParse({ type: "sync.remote", state: { at: "3", playing: false } }).success).toBe(false);
    expect(extensionToPageSchema.safeParse({ type: "hello.ok", version: 1, shortcut: "⌘⇧9" }).success).toBe(true);
    expect(extensionToPageSchema.safeParse({ type: "hello.ok", version: 1, shortcut: "⌘⇧9", features: ["sync"] }).success).toBe(
      true,
    );
  });
});

describe("tab titles", () => {
  it("drops the streaming site's suffix", () => {
    expect(cleanTitle("Stranger Things | Netflix")).toBe("Stranger Things");
    expect(cleanTitle("Watch Andor - Disney+")).toBe("Watch Andor");
    expect(cleanTitle("Fallout – Prime Video")).toBe("Fallout");
    expect(cleanTitle("My home video")).toBe("My home video");
    expect(cleanTitle("x".repeat(300))).toHaveLength(120);
  });

  it("labels a tab by title, else by site", () => {
    expect(tabLabel({ title: "  Dark  ", host: "netflix.com" })).toBe("Dark");
    expect(tabLabel({ title: "", host: "netflix.com" })).toBe("netflix.com");
  });

  it("knows which players need their own seek API", () => {
    expect(seekNeedsPlayerApi("www.netflix.com")).toBe("netflix");
    expect(seekNeedsPlayerApi("netflix.com")).toBe("netflix");
    expect(seekNeedsPlayerApi("notnetflix.com")).toBeNull();
    expect(seekNeedsPlayerApi("www.disneyplus.com")).toBeNull();
  });
});
