import { describe, expect, it } from "vitest";
import { buildInviteUrl, parseInviteInput, safeNextPath } from "@/shared/invite";
import { friendlyError } from "@/shared/errors";
import { buildCsp } from "@/lib/security/csp";

const CODE = "AbCdEfGhIjKlMnOpQrSt_-";

describe("invite parsing", () => {
  it("accepts a bare code", () => expect(parseInviteInput(`  ${CODE} `)).toBe(CODE));
  it("accepts a full invite link", () => expect(parseInviteInput(buildInviteUrl("https://duo.example/", CODE))).toBe(CODE));
  it("rejects junk", () => {
    expect(parseInviteInput("hello")).toBeNull();
    expect(parseInviteInput("https://duo.example/join#short")).toBeNull();
    expect(parseInviteInput(`${CODE}x`)).toBeNull();
  });
  it("keeps the code in the fragment", () =>
    expect(buildInviteUrl("http://localhost:3000", CODE)).toBe(`http://localhost:3000/join#${CODE}`));
});

describe("safeNextPath", () => {
  it.each([
    ["/r/abc", "/r/abc"],
    ["//evil.com", "/home"],
    ["/\\evil.com", "/home"],
    ["https://evil.com", "/home"],
    ["/ok\n", "/home"],
    [null, "/home"],
  ])("%s → %s", (input, expected) => expect(safeNextPath(input)).toBe(expected));
});

describe("friendlyError", () => {
  it("maps known SQL errors", () => expect(friendlyError({ message: "room_full" })).toMatch(/two people/));
  it("hides unknown errors", () =>
    expect(friendlyError({ message: 'relation "x" does not exist' })).toMatch(/Something went wrong/));
  it("maps auth codes", () => expect(friendlyError({ code: "invalid_credentials", message: "x" })).toMatch(/Wrong email/));
});

describe("CSP", () => {
  it("locks scripts to the nonce and forbids framing", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
    process.env.NEXT_PUBLIC_LIVEKIT_URL = "wss://duo-x.livekit.cloud";
    const csp = buildCsp("N0NCE", { isDev: false });
    expect(csp).toContain("script-src 'self' 'nonce-N0NCE' 'strict-dynamic' 'wasm-unsafe-eval'");
    expect(csp).not.toContain(" 'unsafe-eval'"); // only wasm-unsafe-eval in prod
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("wss://abc.supabase.co");
    expect(csp).toContain("wss://duo-x.livekit.cloud");
    expect(csp).toContain("object-src 'none'");
  });
});
