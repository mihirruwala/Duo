import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { DEFAULT_EXTENSION_ID } from "../../src/shared/extension-id";
import { expect, hasBackend, openContexts, test } from "./fixtures";
import { createJoinedRoom, signUpOn } from "./helpers";

const hasLivekit = Boolean(process.env.NEXT_PUBLIC_LIVEKIT_URL && process.env.LIVEKIT_API_KEY);
test.skip(!hasBackend || !hasLivekit, "Supabase + LiveKit env required");

const SHOW = "http://127.0.0.1:4556";
const EXT = join(process.cwd(), "extension/dist-e2e");
let site: Server;

/** Ten minutes of silence as an 8 kHz WAV: a real, seekable media file without any network. */
function silentWav(seconds: number): Buffer {
  const rate = 8000;
  const data = rate * seconds;
  const b = Buffer.alloc(44 + data, 0x80);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + data, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write("data", 36);
  b.writeUInt32LE(data, 40);
  return b;
}

/** A stand-in for a streaming site: one big <video> (plus a small one, like a trailer, to ignore). */
function startShowSite(): Promise<Server> {
  const wav = silentWav(600);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>DUO Show S1E1 | Netflix</title></head>
<body style="margin:0;background:#000">
<video id="trailer" src="/media.wav" width="80" height="45" muted></video>
<video id="main" src="/media.wav" width="960" height="540" preload="auto"></video>
</body></html>`;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/media.wav")) {
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : wav.length - 1;
        res.writeHead(206, {
          "content-type": "audio/wav",
          "accept-ranges": "bytes",
          "content-range": `bytes ${start}-${end}/${wav.length}`,
          "content-length": end - start + 1,
        });
        res.end(wav.subarray(start, end + 1));
      } else {
        res.writeHead(200, { "content-type": "audio/wav", "accept-ranges": "bytes", "content-length": wav.length });
        res.end(wav);
      }
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  return new Promise((resolve) => server.listen(4556, "127.0.0.1", () => resolve(server)));
}

test.beforeAll(async () => {
  execFileSync("node", ["scripts/build-extension.mjs", "--e2e"], { stdio: "ignore" });
  site = await startShowSite();
});
test.afterAll(() => new Promise<void>((r) => site.close(() => r())));

async function extensionContext(): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "duo-sync-")), {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 720 },
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 3100}`,
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
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  sw.on("console", (m) => console.log(`[extension] ${m.type()}: ${m.text()}`));
  return ctx;
}

/** Stand-in for the popup click on "Sync this tab's video with DUO". */
async function syncShowTab(duo: Page) {
  const r = await duo.evaluate(
    ([id, prefix]) =>
      (
        window as unknown as { chrome: { runtime: { sendMessage: (id: string, m: object) => Promise<{ handled: boolean }> } } }
      ).chrome.runtime.sendMessage(id!, { type: "test.bindSyncTab", urlPrefix: prefix }),
    [DEFAULT_EXTENSION_ID, `${SHOW}/show`] as const,
  );
  expect(r.handled).toBe(true);
}

const playback = (show: Page) =>
  show.evaluate(() => {
    const v = document.getElementById("main") as HTMLVideoElement;
    return { at: v.currentTime, paused: v.paused };
  });

async function joinCall(p: Page) {
  await p.getByRole("button", { name: "Join call" }).click();
  await expect(p.getByTestId("meeting-room")).toBeVisible({ timeout: 20_000 });
}

test("sync a show: each plays in their own tab, play / pause / seek follow both ways, stop", async () => {
  test.setTimeout(180_000);
  const hanaCtx = await extensionContext();
  const gabeCtx = await extensionContext();
  const hana = await hanaCtx.newPage();
  const gabe = await gabeCtx.newPage();
  await signUpOn(hana, "Hana");
  await signUpOn(gabe, "Gabe");
  const { roomUrl } = await createJoinedRoom(hana, gabe, "Sync test");
  await hana.goto(roomUrl);
  await joinCall(hana);
  await joinCall(gabe);

  // Each opens the show in their own tab.
  const hanaShow = await hanaCtx.newPage();
  const gabeShow = await gabeCtx.newPage();
  await hanaShow.goto(`${SHOW}/show`);
  await gabeShow.goto(`${SHOW}/show`);

  // Hana: Watch together → Sync a show → instructions → picks her tab in the extension.
  await hana.bringToFront();
  await hana.getByRole("button", { name: "Watch together" }).click();
  await hana.getByRole("button", { name: "Sync a show" }).click();
  await expect(hana.getByTestId("tab-sync-dialog")).toContainText("Sync this tab's video with DUO");
  await syncShowTab(hana);
  await expect(hana.getByTestId("tab-sync-dialog")).toHaveCount(0);
  // The site suffix is dropped from the title.
  await expect(hana.getByTestId("sync-mine")).toHaveText("DUO Show S1E1");
  await expect(gabe.getByTestId("tab-sync-banner")).toContainText("Hana is watching DUO Show S1E1 in sync", {
    timeout: 10_000,
  });

  // Hana starts watching from 2:00 before Gabe has synced.
  await hanaShow.evaluate(async () => {
    const v = document.getElementById("main") as HTMLVideoElement;
    v.currentTime = 120;
    await v.play();
  });

  // Gabe syncs his tab and catches up with her: playing, near her position.
  await gabe.bringToFront();
  await gabe.getByTestId("tab-sync-banner").getByRole("button", { name: "Sync my tab" }).click();
  await expect(gabe.getByTestId("tab-sync-dialog")).toBeVisible();
  await syncShowTab(gabe);
  await expect(gabe.getByTestId("tab-sync-banner")).toContainText("Watching in sync", { timeout: 10_000 });
  await expect(hana.getByTestId("tab-sync-banner")).toContainText("Watching in sync", { timeout: 10_000 });
  await expect
    .poll(
      async () => {
        const [h, g] = await Promise.all([playback(hanaShow), playback(gabeShow)]);
        return !g.paused && Math.abs(h.at - g.at) < 1.5;
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  // Gabe pauses in his tab: Hana's pauses too, at the same spot.
  await gabeShow.evaluate(() => (document.getElementById("main") as HTMLVideoElement).pause());
  await expect
    .poll(
      async () => {
        const [h, g] = await Promise.all([playback(hanaShow), playback(gabeShow)]);
        return h.paused && Math.abs(h.at - g.at) < 0.6;
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  // Hana skips to 5:00 while paused: Gabe follows.
  await hanaShow.evaluate(() => {
    (document.getElementById("main") as HTMLVideoElement).currentTime = 300;
  });
  await expect.poll(async () => (await playback(gabeShow)).at, { timeout: 10_000 }).toBeGreaterThan(299);
  expect((await playback(gabeShow)).paused).toBe(true);

  // Hana plays: Gabe plays.
  await hanaShow.evaluate(() => (document.getElementById("main") as HTMLVideoElement).play());
  await expect.poll(async () => (await playback(gabeShow)).paused, { timeout: 10_000 }).toBe(false);

  // Gabe stops syncing: Hana sees she's waiting again, and her pausing no longer moves his tab.
  await gabe.getByTestId("tab-sync-banner").getByRole("button", { name: "Stop syncing" }).click();
  await expect(gabe.getByTestId("tab-sync-banner")).toContainText("Hana is watching", { timeout: 10_000 });
  await expect(hana.getByTestId("tab-sync-banner")).toContainText("Waiting for your person", { timeout: 10_000 });
  await hanaShow.evaluate(() => (document.getElementById("main") as HTMLVideoElement).pause());
  await gabe.waitForTimeout(2500);
  expect((await playback(gabeShow)).paused).toBe(false);
});
