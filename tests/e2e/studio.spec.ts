import type { Page } from "@playwright/test";
import { expect, hasBackend, test } from "./fixtures";
import { createJoinedRoom, expectVideoPlaying, newUserPage } from "./helpers";

const hasLivekit = Boolean(process.env.NEXT_PUBLIC_LIVEKIT_URL && process.env.LIVEKIT_API_KEY);
test.skip(!hasBackend || !hasLivekit, "Supabase + LiveKit env required");

type FrameStats = {
  r: number;
  g: number;
  b: number;
  sat: number;
  edges: number;
  topB: number;
  topG: number;
  w: number;
  h: number;
};

/**
 * Pixel statistics of whatever a <video> is currently showing (decoded frames, i.e. exactly what
 * this person sees). Channels 0..1; `edges` is mean absolute horizontal gradient (sharpness).
 */
async function frameStats(page: Page, selector: string): Promise<FrameStats> {
  return page.evaluate((sel) => {
    const v = document.querySelector<HTMLVideoElement>(sel)!;
    const w = 160;
    const h = Math.round((160 * v.videoHeight) / v.videoWidth) || 90;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let r = 0,
      g = 0,
      b = 0,
      sat = 0,
      edges = 0,
      topB = 0,
      topG = 0,
      topN = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const R = d[i]! / 255,
          G = d[i + 1]! / 255,
          B = d[i + 2]! / 255;
        r += R;
        g += G;
        b += B;
        const mx = Math.max(R, G, B),
          mn = Math.min(R, G, B);
        sat += mx === 0 ? 0 : (mx - mn) / mx;
        if (x > 0) edges += Math.abs(G - d[i - 3]! / 255);
        if (y < h / 4) {
          topB += B;
          topG += G;
          topN++;
        }
      }
    }
    const n = w * h;
    return {
      r: r / n,
      g: g / n,
      b: b / n,
      sat: sat / n,
      edges: edges / n,
      topB: topB / topN,
      topG: topG / topN,
      w: v.videoWidth,
      h: v.videoHeight,
    };
  }, selector);
}

async function pick(page: Page, tab: string, option: string) {
  await page.getByRole("tab", { name: tab }).click();
  await page.getByTestId(`studio-option-${option}`).click();
}

const REMOTE = '[data-testid="tile-remote"] video';

test("DUO Studio: effects run on-device and the other person receives the processed video", async ({ browser }) => {
  test.setTimeout(240_000);
  const host = await newUserPage(browser, "Hana");
  const guest = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(host, guest, "Studio test");
  await host.goto(`${roomUrl}?debug=1`);
  const gl = await host.evaluate(() => {
    const g = document.createElement("canvas").getContext("webgl2");
    const ext = g?.getExtension("WEBGL_debug_renderer_info");
    return ext ? g!.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  console.log(`WebGL renderer: ${gl}`);

  // Pre-call: pick Black & white; the local preview turns grey.
  await expectVideoPlaying(host, "body");
  await host.getByTestId("open-studio").click();
  await expect(host.getByTestId("studio-panel")).toBeVisible();
  await pick(host, "Live effects", "black-white");
  await expect
    .poll(async () => (await frameStats(host, '[data-testid="studio-preview"]')).sat, { timeout: 30_000 })
    .toBeLessThan(0.05);
  await host.keyboard.press("Escape");
  await expect(host.getByTestId("open-studio")).toContainText("Black & white");

  // Both join. Gabe's view of Hana is grey too: the processed track is what's published.
  for (const p of [host, guest]) {
    await p.getByRole("button", { name: "Join call" }).click();
    await expect(p.getByTestId("meeting-room")).toBeVisible({ timeout: 20_000 });
  }
  await expectVideoPlaying(guest, '[data-testid="tile-remote"]');
  await expect.poll(async () => (await frameStats(guest, REMOTE)).sat, { timeout: 30_000 }).toBeLessThan(0.05);
  const bw = await frameStats(guest, REMOTE);
  console.log(`remote frame ${bw.w}×${bw.h}, B&W saturation ${bw.sat.toFixed(3)}`);

  // Mid-call switch to Invert: no renegotiation, the remote side follows. Chrome's fake camera is mostly
  // green, so inverted it becomes magenta (red + blue above green).
  await host.getByRole("button", { name: "Effects" }).click();
  await pick(host, "Live effects", "invert");
  await expect
    .poll(
      async () => {
        const s = await frameStats(guest, REMOTE);
        return s.r > s.g && s.b > s.g;
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  // Background replacement: with no person in the fake camera, the whole frame becomes the tropical
  // scene, whose top quarter is sky blue (blue well above green). Effects off first.
  await pick(host, "Live effects", "none");
  await pick(host, "Backgrounds", "tropical-escape");
  await expect
    .poll(
      async () => {
        const s = await frameStats(guest, REMOTE);
        return s.topB - s.topG;
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0.1);

  // Blur: compare sharpness of the remote frame with and without blur.
  await pick(host, "Backgrounds", "none");
  await expect
    .poll(async () => (await frameStats(guest, REMOTE)).topB - (await frameStats(guest, REMOTE)).topG, { timeout: 20_000 })
    .toBeLessThan(0.05);
  await guest.waitForTimeout(1500);
  const sharp = await frameStats(guest, REMOTE);
  await pick(host, "Backgrounds", "blur");
  await expect.poll(async () => (await frameStats(guest, REMOTE)).edges, { timeout: 30_000 }).toBeLessThan(sharp.edges * 0.6);
  const blurred = await frameStats(guest, REMOTE);
  console.log(`edge energy: sharp ${sharp.edges.toFixed(4)} → blurred ${blurred.edges.toFixed(4)}`);

  // Performance with blur running (dev/debug read-out from the worker).
  await host.keyboard.press("Escape");
  await expect(host.getByTestId("studio-perf").first()).toBeVisible({ timeout: 15_000 });
  await host.waitForTimeout(6000); // past model warm-up
  const perfBlur = await host.getByTestId("studio-perf").first().textContent();
  console.log(`perf (blur): ${perfBlur}`);

  // Face filter: the landmarker loads and runs (the fake camera has no face, so no props are drawn).
  await host.getByRole("button", { name: "Effects" }).click();
  await pick(host, "Backgrounds", "none");
  await pick(host, "Funny", "cool-shades");
  await host.keyboard.press("Escape");
  await expect
    .poll(async () => Number((await host.getByTestId("studio-perf").first().textContent())?.match(/face ([\d.]+)/)?.[1] ?? 0), {
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
  await host.waitForTimeout(8000); // past model warm-up
  const perfFace = await host.getByTestId("studio-perf").first().textContent();
  console.log(`perf (face tracking): ${perfFace}`);

  // Everything off → processor removed; remote video back to the raw camera (green, saturated).
  await host.getByRole("button", { name: "Effects" }).click();
  await host.getByRole("button", { name: "Turn everything off" }).click();
  await host.keyboard.press("Escape");
  await expect(host.getByTestId("studio-perf")).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(async () => (await frameStats(guest, REMOTE)).sat, { timeout: 20_000 }).toBeGreaterThan(0.3);
});
