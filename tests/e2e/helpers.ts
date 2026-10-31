import type { Browser, Page } from "@playwright/test";
import { expect, openContexts } from "./fixtures";

export const PASSWORD = "duo-e2e-password-123";
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let userSeq = 0;

/**
 * Test double for getDisplayMedia: real screen capture needs an OS permission prompt that
 * CI can't click, so we return an animated canvas stream. Streams are kept on window so a
 * test can end them exactly like the browser's native "Stop sharing" button does.
 */
export const FAKE_DISPLAY_MEDIA = () => {
  const w = window as unknown as { __duoDisplayStreams: MediaStream[] };
  w.__duoDisplayStreams = [];
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d")!;
    let t = 0;
    const draw = () => {
      ctx.fillStyle = `hsl(${t % 360} 70% 50%)`;
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = "#fff";
      ctx.font = "64px sans-serif";
      ctx.fillText(`shared screen ${t++}`, 80, 360);
      requestAnimationFrame(draw);
    };
    draw();
    const stream = canvas.captureStream(15);
    w.__duoDisplayStreams.push(stream);
    return stream;
  };
};

const emails = new WeakMap<Page, string>();
/** Email of a user created with newUserPage (same password for all: PASSWORD). */
export function emailOf(page: Page): string {
  const e = emails.get(page);
  if (!e) throw new Error("page was not created by newUserPage");
  return e;
}

export async function newUserPage(browser: Browser, name: string, opts: { fakeDisplay?: boolean } = {}): Promise<Page> {
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  openContexts.add(context);
  if (opts.fakeDisplay) await context.addInitScript(FAKE_DISPLAY_MEDIA);
  const page = await context.newPage();
  await signUpOn(page, name);
  return page;
}

/** Create an account in an existing page (e.g. one inside an extension-enabled context). */
export async function signUpOn(page: Page, name: string): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  const email = `duo-e2e-${name.toLowerCase()}-${run}-${++userSeq}@example.com`;
  emails.set(page, email);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/home$/);
}

/** Host creates a room, guest redeems the invite. Returns the room URL and invite URL. */
export async function createJoinedRoom(host: Page, guest: Page, roomName = "E2E hangout") {
  await host.getByRole("button", { name: "New room" }).first().click();
  await host.getByLabel("Room name").fill(roomName);
  await host.getByRole("button", { name: "Create room" }).click();
  const inviteUrl = await host.getByTestId("invite-link").inputValue();
  await host.getByRole("link", { name: /Enter room/ }).click();
  await expect(host).toHaveURL(/\/r\/[A-Za-z0-9_-]{22}$/);
  const roomUrl = host.url();

  const invite = new URL(inviteUrl);
  await guest.goto(invite.pathname + invite.hash);
  await guest.getByRole("button", { name: "Join room" }).click();
  await expect(guest).toHaveURL(roomUrl);
  return { roomUrl, inviteUrl };
}

/** Resolves once the <video> inside `selector` is actually decoding frames. */
export async function expectVideoPlaying(page: Page, selector: string) {
  await expect
    .poll(
      () =>
        page.evaluate((sel) => {
          const v = document.querySelector<HTMLVideoElement>(`${sel} video`);
          return v ? v.videoWidth > 0 && !v.paused && v.readyState >= 2 : false;
        }, selector),
      { timeout: 20_000 },
    )
    .toBe(true);
}

/**
 * Measures the energy of the *decoded* remote audio this page is playing (Web Audio analyser
 * on the <audio> elements LiveKit renders). Non-zero means sound actually arrived and decoded.
 */
export async function remoteAudioPeak(page: Page, ms = 3000): Promise<number> {
  return page.evaluate(async (duration) => {
    const streams = Array.from(document.querySelectorAll("audio"))
      .map((a) => a.srcObject)
      .filter((s): s is MediaStream => s instanceof MediaStream && s.getAudioTracks().length > 0);
    if (streams.length === 0) return 0;
    const ctx = new AudioContext();
    await ctx.resume();
    const analysers = streams.map((s) => {
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(s).connect(an);
      return an;
    });
    const buf = new Float32Array(1024);
    let peak = 0;
    const end = performance.now() + duration;
    while (performance.now() < end) {
      for (const an of analysers) {
        an.getFloatTimeDomainData(buf);
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    await ctx.close();
    return peak;
  }, ms);
}
