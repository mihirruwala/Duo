import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_EXTENSION_ID } from "../../src/shared/extension-id";
import { startTargetSite } from "./control-target";
import { expect, hasBackend, openContexts, test } from "./fixtures";
import { createJoinedRoom, emailOf, expectVideoPlaying, newUserPage, PASSWORD, signUpOn } from "./helpers";

const hasLivekit = Boolean(process.env.NEXT_PUBLIC_LIVEKIT_URL && process.env.LIVEKIT_API_KEY);
test.skip(!hasBackend || !hasLivekit, "Supabase + LiveKit env required");

const TARGET = "http://127.0.0.1:4555";
const EXT = join(process.cwd(), "extension/dist-e2e");
let site: Server;

test.beforeAll(async () => {
  execFileSync("node", ["scripts/build-extension.mjs", "--e2e"], { stdio: "ignore" });
  site = await startTargetSite();
});
test.afterAll(() => new Promise<void>((r) => site.close(() => r())));

/**
 * The tab capture stream id from the real popup flow can't be produced in automation (it needs the
 * activeTab grant from a human click), so the E2E build binds the tab via a test hook and the page's
 * getUserMedia({chromeMediaSource:"tab"}) is answered with a canvas. Everything after that, the
 * approval, LiveKit data path, extension validation and CDP input into the real target tab, is the
 * production code path.
 */
const FAKE_TAB_CAPTURE = () => {
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
    const v = c?.video as { mandatory?: { chromeMediaSource?: string } } | undefined;
    if (v?.mandatory?.chromeMediaSource !== "tab") return orig(c);
    const canvas = Object.assign(document.createElement("canvas"), { width: 1280, height: 720 });
    const ctx = canvas.getContext("2d")!;
    let t = 0;
    const draw = () => {
      ctx.fillStyle = `hsl(${t++ % 360} 40% 85%)`;
      ctx.fillRect(0, 0, 1280, 720);
      requestAnimationFrame(draw);
    };
    draw();
    return canvas.captureStream(15);
  };
};

async function ownerContext(): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "duo-owner-")), {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 720 },
    baseURL: `http://localhost:${process.env.E2E_PORT ?? 3100}`,
    permissions: ["camera", "microphone"],
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  openContexts.add(ctx);
  await ctx.addInitScript(FAKE_TAB_CAPTURE);
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  sw.on("console", (m) => console.log(`[extension] ${m.type()}: ${m.text()}`));
  return ctx;
}

const target = (page: Page) => page.evaluate(() => (window as unknown as { __duo: Record<string, unknown> }).__duo);

/** Click the controller's surface at the spot that maps to (x, y) CSS px in the 1280×720 target. */
async function remoteClick(guest: Page, x: number, y: number, opts: { button?: "left" | "right"; clickCount?: number } = {}) {
  const p = await surfacePoint(guest, x, y);
  await guest.mouse.click(p.x, p.y, { button: opts.button ?? "left", clickCount: opts.clickCount ?? 1 });
}
async function surfacePoint(guest: Page, x: number, y: number) {
  return guest.evaluate(
    ([tx, ty]) => {
      const v = document.querySelector<HTMLVideoElement>('[data-testid="share-remote"] video')!;
      const r = v.getBoundingClientRect();
      const ratio = v.videoWidth / v.videoHeight;
      const w = Math.min(r.width, r.height * ratio);
      const h = w / ratio;
      return { x: r.left + (r.width - w) / 2 + (tx! / 1280) * w, y: r.top + (r.height - h) / 2 + (ty! / 720) * h };
    },
    [x, y],
  );
}

async function joinCall(page: Page) {
  await page.getByRole("button", { name: "Join call" }).click();
  await expect(page.getByTestId("meeting-room")).toBeVisible();
  await expect(page.getByTestId("connection-state")).toContainText("Connected", { timeout: 20_000 });
}

test("remote control: approve, click/type/scroll/drag/navigate, revoke, emergency stop, blocked pages, audit log", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = await ownerContext();
  const hostPage = await owner.newPage();
  await signUpOn(hostPage, "Hana");
  const guest = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(hostPage, guest, "Control test");

  // The tab Hana will share, plus another tab that must stay unreachable.
  const tab = await owner.newPage();
  await tab.goto(`${TARGET}/target`);
  const otherTab = await owner.newPage();
  await otherTab.goto(`${TARGET}/other`);

  await hostPage.bringToFront();
  await hostPage.goto(roomUrl);
  await joinCall(hostPage);
  await guest.goto(roomUrl);
  await joinCall(guest);

  // Pages that aren't DUO can't even talk to the extension (externally_connectable).
  expect(
    await tab.evaluate(
      () => typeof (window as unknown as { chrome?: { runtime?: { connect?: unknown } } }).chrome?.runtime?.connect,
    ),
  ).toBe("undefined");

  // Owner: Share → "a tab they can control" → instructions (extension detected) → pick the tab.
  await hostPage.getByRole("button", { name: "Share screen" }).click();
  await hostPage.getByRole("menuitem", { name: /Share a tab they can control/ }).click();
  await expect(hostPage.getByRole("heading", { name: "Pick the tab to share" })).toBeVisible();
  const bound = await hostPage.evaluate(
    ([id, prefix]) =>
      (
        window as unknown as { chrome: { runtime: { sendMessage: (id: string, m: object) => Promise<{ handled: boolean }> } } }
      ).chrome.runtime.sendMessage(id!, { type: "test.bindTab", urlPrefix: prefix }),
    [DEFAULT_EXTENSION_ID, `${TARGET}/target`] as const,
  );
  expect(bound.handled).toBe(true);
  await expect(hostPage.getByTestId("share-local")).toContainText("“DUO Target” is live");

  // Controller sees the share and asks for control.
  await expect(guest.getByTestId("share-remote")).toBeVisible({ timeout: 15_000 });
  await expectVideoPlaying(guest, '[data-testid="share-remote"]');
  await guest.getByTestId("request-control").click();
  await expect(guest.getByTestId("controller-bar")).toContainText("Waiting for Hana");

  // Nothing reaches the tab before approval.
  await remoteClick(guest, 200, 140);
  await hostPage.waitForTimeout(800);
  expect((await target(tab)).clicks).toBe(0);

  // Owner approves.
  await expect(hostPage.getByTestId("control-request-dialog")).toContainText("Gabe wants to click, scroll and type");
  if (process.env.DUO_SHOTS) await hostPage.screenshot({ path: `${process.env.DUO_SHOTS}/ctl-approve.png` });
  await hostPage.getByTestId("approve-control").click();
  await expect(hostPage.getByTestId("control-active-banner")).toContainText("Gabe is controlling “DUO Target”");
  await expect(guest.getByTestId("controller-bar")).toContainText("You're controlling Hana's tab");
  // Indicator on the controlled tab itself.
  await expect(tab.locator("[data-duo-control]")).toHaveCount(1, { timeout: 10_000 });
  if (process.env.DUO_SHOTS) {
    await hostPage.screenshot({ path: `${process.env.DUO_SHOTS}/ctl-owner.png` });
    const sp0 = await surfacePoint(guest, 640, 300);
    await guest.mouse.move(sp0.x, sp0.y);
    await guest.screenshot({ path: `${process.env.DUO_SHOTS}/ctl-guest.png` });
    await tab.screenshot({ path: `${process.env.DUO_SHOTS}/ctl-tab.png` });
  }

  // Click (trusted), double-click, right-click.
  await remoteClick(guest, 200, 140);
  await expect.poll(async () => (await target(tab)).clicks, { timeout: 10_000 }).toBe(1);
  expect((await target(tab)).trusted).toBe(true);
  await remoteClick(guest, 200, 140, { clickCount: 2 });
  await expect.poll(async () => (await target(tab)).dbl, { timeout: 10_000 }).toBe(1);
  await remoteClick(guest, 200, 140, { button: "right" });
  await expect.poll(async () => (await target(tab)).ctx, { timeout: 10_000 }).toBe(1);

  // Typing into a text field, including select-all + retype; paste is refused.
  await remoteClick(guest, 300, 260);
  await guest.keyboard.type("hello duo", { delay: 30 });
  await expect.poll(() => tab.inputValue("#name"), { timeout: 10_000 }).toBe("hello duo");
  await guest.keyboard.press("ControlOrMeta+a");
  await guest.keyboard.type("hi!", { delay: 30 });
  await expect.poll(() => tab.inputValue("#name"), { timeout: 10_000 }).toBe("hi!");
  await tab.evaluate(() => navigator.clipboard.writeText("owner secret").catch(() => undefined));
  await guest.keyboard.press("ControlOrMeta+v");
  await guest.waitForTimeout(600);
  expect(await tab.inputValue("#name")).toBe("hi!");

  // Scroll inside the page.
  const sp = await surfacePoint(guest, 850, 250);
  await guest.mouse.move(sp.x, sp.y);
  await guest.mouse.wheel(0, 600);
  await expect
    .poll(() => tab.evaluate(() => document.getElementById("scroller")!.scrollTop), { timeout: 10_000 })
    .toBeGreaterThan(100);

  // Drag.
  const a = await surfacePoint(guest, 150, 470);
  const b = await surfacePoint(guest, 450, 500);
  await guest.mouse.move(a.x, a.y);
  await guest.mouse.down();
  await guest.mouse.move(b.x, b.y, { steps: 8 });
  await guest.mouse.up();
  await expect
    .poll(async () => (await target(tab)).drag as { dx: number } | null, { timeout: 10_000 })
    .toMatchObject({ dx: expect.any(Number) });
  expect(((await target(tab)).drag as { dx: number }).dx).toBeGreaterThan(200);

  // The other tab never received anything.
  expect((await target(otherTab)).clicks).toBe(0);

  // Navigate by clicking a link; control continues on the new page.
  await remoteClick(guest, 140, 608);
  await expect(tab).toHaveTitle("DUO Target page 2", { timeout: 10_000 });
  await expect(tab.locator("[data-duo-control]")).toHaveCount(1, { timeout: 10_000 });
  await remoteClick(guest, 200, 140);
  await expect.poll(async () => (await target(tab)).clicks, { timeout: 10_000 }).toBe(1);

  // Revoke → instant on both sides; further input is ignored; indicator removed.
  const revokedAt = Date.now();
  await hostPage.getByTestId("revoke-control").click();
  await expect(guest.getByTestId("request-control")).toBeVisible({ timeout: 5_000 });
  console.log(`revoke → controller UI updated in ${Date.now() - revokedAt} ms`);
  await expect(hostPage.getByTestId("control-active-banner")).toHaveCount(0);
  await expect(tab.locator("[data-duo-control]")).toHaveCount(0);
  await remoteClick(guest, 200, 140);
  await guest.waitForTimeout(800);
  expect((await target(tab)).clicks).toBe(1);

  // Second session → emergency stop (the extension's global command handler).
  await guest.getByTestId("request-control").click();
  await hostPage.getByTestId("approve-control").click();
  await expect(guest.getByTestId("controller-bar")).toContainText("You're controlling");
  await hostPage.evaluate(
    (id) =>
      (
        window as unknown as { chrome: { runtime: { sendMessage: (id: string, m: object) => Promise<unknown> } } }
      ).chrome.runtime.sendMessage(id, { type: "test.command", command: "emergency-stop" }),
    DEFAULT_EXTENSION_ID,
  );
  await expect(guest.getByTestId("request-control")).toBeVisible({ timeout: 5_000 });
  await expect(hostPage.getByTestId("control-active-banner")).toHaveCount(0);

  // Third session → the shared tab navigates to a blocked page (DUO itself) → control ends.
  await guest.getByTestId("request-control").click();
  await hostPage.getByTestId("approve-control").click();
  await expect(guest.getByTestId("controller-bar")).toContainText("You're controlling");
  await tab.goto(new URL(roomUrl).origin + "/");
  await expect(guest.getByTestId("request-control")).toBeVisible({ timeout: 10_000 });
  await expect(hostPage.getByTestId("control-active-banner")).toHaveCount(0);

  // Audit log: every session recorded with who approved and how it ended.
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  await sb.auth.signInWithPassword({ email: emailOf(hostPage), password: PASSWORD });
  const { data: rooms } = await sb.from("rooms").select("id").eq("slug", new URL(roomUrl).pathname.split("/").pop()!);
  await expect
    .poll(
      async () => {
        const { data } = await sb
          .from("control_sessions")
          .select("status, end_reason, decided_at")
          .eq("room_id", rooms![0]!.id)
          .order("requested_at");
        return data?.map((r) => `${r.status}:${r.end_reason ?? ""}:${r.decided_at ? "decided" : "-"}`);
      },
      { timeout: 10_000 },
    )
    .toEqual(["revoked:owner_revoked:decided", "revoked:emergency_stop:decided", "ended:blocked_url:decided"]);
});

test("a DUO page can't be controlled, and requests are refused when nothing controllable is shared", async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await ownerContext();
  const hostPage = await owner.newPage();
  await signUpOn(hostPage, "Hana");
  const guest = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(hostPage, guest, "Policy test");
  await hostPage.goto(roomUrl);
  await joinCall(hostPage);

  // Try to bind the DUO tab itself: the extension refuses (policy), so nothing is shared.
  const res = await hostPage.evaluate(
    ([id, prefix]) =>
      (
        window as unknown as { chrome: { runtime: { sendMessage: (id: string, m: object) => Promise<{ handled: boolean }> } } }
      ).chrome.runtime.sendMessage(id!, { type: "test.bindTab", urlPrefix: prefix }),
    [DEFAULT_EXTENSION_ID, new URL(roomUrl).origin] as const,
  );
  expect(res.handled).toBe(true);
  await hostPage.waitForTimeout(1000);
  await expect(hostPage.getByTestId("share-local")).toHaveCount(0);

  // Nothing is shared and no session exists: the extension shows no sharing/control badge.
  const sw = owner.serviceWorkers()[0]!;
  const badgeBefore = await sw.evaluate(() => chrome.action.getBadgeText({}));
  expect(badgeBefore).toBe("");
});
