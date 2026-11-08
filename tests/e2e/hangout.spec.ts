import type { Page } from "@playwright/test";
import { expect, hasBackend, test } from "./fixtures";
import { createJoinedRoom, expectVideoPlaying, newUserPage, remoteAudioPeak } from "./helpers";

test.skip(!hasBackend || !process.env.NEXT_PUBLIC_LIVEKIT_URL, "Supabase + LiveKit env required");

/** Height of a video on this page (adaptive stream sizes the remote one to its tile, so it can't prove much). */
const videoHeight = (p: Page, tile: "tile-local" | "tile-remote") =>
  p.evaluate((t) => document.querySelector<HTMLVideoElement>(`[data-testid="${t}"] video`)?.videoHeight ?? 0, tile);
const camHeight = (p: Page) => videoHeight(p, "tile-local");

async function join(p: Page) {
  await p.getByRole("button", { name: "Join call" }).click();
  await expect(p.getByTestId("meeting-room")).toBeVisible({ timeout: 20_000 });
}

test("hang-out mode: light video both ways, effects paused, sleep and wake, survives a rejoin", async ({ browser }) => {
  test.setTimeout(180_000);
  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(hana, gabe, "Hang-out test");
  await hana.goto(roomUrl);
  await join(hana);
  await join(gabe);
  await expectVideoPlaying(hana, '[data-testid="tile-remote"]');
  await expectVideoPlaying(gabe, '[data-testid="tile-remote"]');
  // Normal call: the camera is captured at 720p.
  await expect.poll(() => camHeight(hana), { timeout: 10_000 }).toBe(720);

  // Hana turns it on: her camera is re-captured (and so sent) at 360p.
  await hana.getByRole("button", { name: "Hang-out mode" }).click();
  await expect(hana.getByTestId("hangout-banner")).toBeVisible();
  await expect(gabe.getByTestId("partner-mode")).toHaveText("Hana is hanging out", { timeout: 10_000 });
  await expect(hana.getByRole("button", { name: "Effects are paused in hang-out mode" })).toBeDisabled();
  await expect.poll(() => camHeight(hana), { timeout: 15_000 }).toBe(360);
  await expectVideoPlaying(gabe, '[data-testid="tile-remote"]');
  expect(await videoHeight(gabe, "tile-remote")).toBeLessThanOrEqual(360);
  await expect(gabe.getByTestId("tile-remote")).toHaveAttribute("data-has-video", "");

  // Sleep: black screen, her camera goes off, sound still goes both ways.
  await hana.getByRole("button", { name: "Sleep" }).click();
  await expect(hana.getByTestId("sleep-screen")).toBeVisible();
  await expect(hana.getByTestId("sleep-screen")).toContainText("Gabe can still hear you");
  await expect(gabe.getByTestId("partner-mode")).toHaveText("Hana is asleep", { timeout: 10_000 });
  await expect(gabe.getByTestId("tile-remote")).not.toHaveAttribute("data-has-video", "", { timeout: 10_000 });
  await expect.poll(() => remoteAudioPeak(gabe), { timeout: 20_000 }).toBeGreaterThan(0.01);
  await expect.poll(() => remoteAudioPeak(hana), { timeout: 20_000 }).toBeGreaterThan(0.01);
  // Gabe's video isn't downloaded while she sleeps.
  await expect
    .poll(
      () =>
        hana.evaluate(async () => {
          const v = document.querySelector<HTMLVideoElement>('[data-testid="tile-remote"] video');
          const t = (v?.srcObject as MediaStream | null)?.getVideoTracks()[0];
          if (!v || !t) return "gone";
          const before = v.getVideoPlaybackQuality().totalVideoFrames;
          await new Promise((r) => setTimeout(r, 1500));
          return v.getVideoPlaybackQuality().totalVideoFrames - before <= 1 ? "stopped" : "playing";
        }),
      { timeout: 20_000 },
    )
    .not.toBe("playing");

  // A tap wakes her: camera back on, still hanging out.
  await hana.getByTestId("sleep-screen").click();
  await expect(hana.getByTestId("sleep-screen")).toHaveCount(0);
  await expect(hana.getByTestId("hangout-banner")).toBeVisible();
  await expect(gabe.getByTestId("partner-mode")).toHaveText("Hana is hanging out", { timeout: 10_000 });
  await expect(gabe.getByTestId("tile-remote")).toHaveAttribute("data-has-video", "", { timeout: 15_000 });
  await expectVideoPlaying(hana, '[data-testid="tile-remote"]');

  // A reload (like a rejoin after a dropped connection) keeps the mode, and Gabe is told again.
  await hana.reload();
  await join(hana);
  await expect(hana.getByTestId("hangout-banner")).toBeVisible();
  await expect(gabe.getByTestId("partner-mode")).toHaveText("Hana is hanging out", { timeout: 15_000 });
  await expect.poll(() => camHeight(hana), { timeout: 15_000 }).toBe(360);

  // Off again: back to full quality.
  await hana.getByRole("button", { name: "Turn off hang-out mode" }).first().click();
  await expect(hana.getByTestId("hangout-banner")).toHaveCount(0);
  await expect(gabe.getByTestId("partner-mode")).toHaveCount(0, { timeout: 10_000 });
  await expect(hana.getByRole("button", { name: "Effects", exact: true })).toBeEnabled();
  await expect.poll(() => camHeight(hana), { timeout: 15_000 }).toBe(720);
  await expectVideoPlaying(gabe, '[data-testid="tile-remote"]');
});
