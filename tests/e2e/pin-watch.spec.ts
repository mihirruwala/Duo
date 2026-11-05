import type { Page } from "@playwright/test";
import { expect, hasBackend, test } from "./fixtures";
import { createJoinedRoom, expectVideoPlaying, newUserPage, remoteAudioPeak } from "./helpers";

test.skip(!hasBackend || !process.env.NEXT_PUBLIC_LIVEKIT_URL, "Supabase + LiveKit env required");

async function joinCall(pages: Page[]) {
  for (const p of pages) {
    await p.getByRole("button", { name: "Join call" }).click();
    await expect(p.getByTestId("meeting-room")).toBeVisible({ timeout: 20_000 });
  }
  for (const p of pages) await expectVideoPlaying(p, '[data-testid="tile-remote"]');
}

const stage = (p: Page) => p.getByTestId("call-stage");

test("pin: spotlight your person, swap with a click, keep them big over a screen share", async ({ browser }) => {
  test.setTimeout(150_000);
  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe", { fakeDisplay: true });
  const { roomUrl } = await createJoinedRoom(hana, gabe, "Pin test");
  await hana.goto(roomUrl);
  await joinCall([hana, gabe]);

  // Side by side until someone pins.
  await expect(stage(hana)).toHaveAttribute("data-layout", "duo");

  // Pin Gabe: he fills the stage, Hana's own camera floats in the corner. Only Hana's view changes.
  await hana.getByTestId("tile-remote").hover();
  await hana.getByRole("button", { name: "Pin Gabe" }).click();
  await expect(stage(hana)).toHaveAttribute("data-main", "them");
  await expect(hana.getByTestId("tile-remote")).toHaveAttribute("data-slot", "main");
  await expect(hana.getByTestId("tile-local")).toHaveAttribute("data-slot", "float");
  await expect(stage(gabe)).toHaveAttribute("data-layout", "duo");
  const big = await hana.getByTestId("tile-remote").boundingBox();
  const small = await hana.getByTestId("tile-local").boundingBox();
  expect(big!.width).toBeGreaterThan(small!.width * 3);
  await expectVideoPlaying(hana, '[data-testid="tile-remote"]');

  // Tap the small tile to swap.
  await hana.getByRole("button", { name: "Make yourself big" }).click();
  await expect(stage(hana)).toHaveAttribute("data-main", "me");
  await expect(hana.getByTestId("tile-remote")).toHaveAttribute("data-slot", "float");
  await hana.getByRole("button", { name: "Make Gabe big" }).click();
  await expect(stage(hana)).toHaveAttribute("data-main", "them");

  // The pin is remembered for the next call on this device.
  await hana.reload();
  await hana.getByRole("button", { name: "Join call" }).click();
  await expect(stage(hana)).toHaveAttribute("data-main", "them", { timeout: 20_000 });
  await expectVideoPlaying(hana, '[data-testid="tile-remote"]');

  // Gabe shares his screen. Hana keeps him pinned: his face stays big, the share becomes a thumbnail
  // that keeps playing; one tap brings the share back.
  await gabe.getByRole("button", { name: "Share screen" }).click();
  await gabe.getByRole("menuitem", { name: /Share screen, window or tab/ }).click();
  await expect(gabe.getByTestId("share-local")).toBeVisible({ timeout: 10_000 });
  await expect(stage(hana)).toHaveAttribute("data-layout", "side", { timeout: 15_000 });
  await expect(stage(hana)).toHaveAttribute("data-main", "them");
  await expect(hana.getByTestId("share-remote")).toHaveAttribute("data-slot", "thumb");
  await expectVideoPlaying(hana, '[data-testid="share-remote"]');
  await hana.getByRole("button", { name: "Make Gabe's screen big" }).click();
  await expect(stage(hana)).toHaveAttribute("data-main", "content");
  await expect(hana.getByTestId("share-remote")).toHaveAttribute("data-slot", "main");
  await expect(hana.getByTestId("tile-remote")).toHaveAttribute("data-slot", "t1");

  // Pin from the small tile's pin button; double-click the big tile to unpin.
  await hana.getByTestId("tile-remote").hover();
  await hana.getByRole("button", { name: "Pin Gabe" }).click();
  await expect(stage(hana)).toHaveAttribute("data-main", "them");
  await hana.getByTestId("tile-remote").dblclick();
  await expect(stage(hana)).toHaveAttribute("data-main", "content");
  await hana.getByTestId("tile-remote").dblclick(); // small again: double-click must not flip-flop
  await expect(stage(hana)).toHaveAttribute("data-main", "them");
});

// A short Creative Commons film (Big Buck Bunny, Blender Foundation's own channel).
const VIDEO = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";

/** The <video> inside YouTube's player frame. */
const ytVideo = (p: Page) => p.frameLocator('[data-testid="watch-iframe"]').locator("video");
const ytState = (p: Page) =>
  ytVideo(p).evaluate((v: HTMLVideoElement) => ({ paused: v.paused, t: v.currentTime }), undefined, { timeout: 5_000 });

test("Watch Together: one person starts a YouTube video, playback stays in sync both ways", async ({ browser }) => {
  test.setTimeout(180_000);
  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(hana, gabe, "Movie night");
  await hana.goto(roomUrl);
  await joinCall([hana, gabe]);

  // A bad link is caught in the dialog.
  await hana.getByRole("button", { name: "Watch together" }).click();
  await hana.getByLabel("YouTube link").fill("https://example.com/not-a-video");
  await hana.getByRole("button", { name: "Start" }).click();
  await expect(hana.getByText("That doesn't look like a YouTube link.")).toBeVisible();

  await hana.getByLabel("YouTube link").fill(VIDEO);
  await hana.getByRole("button", { name: "Start" }).click();
  for (const p of [hana, gabe]) {
    await expect(p.getByTestId("watch-stage")).toHaveAttribute("data-video-id", "aqz-KE-bpKQ", { timeout: 20_000 });
    await expect(p.getByTestId("watch-stage")).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  }
  await expect(gabe.getByText("Hana started Watch Together 🍿")).toBeVisible();
  await expect(gabe.getByText(/started by Hana/)).toBeVisible();

  // Both are playing the film itself (YouTube reports "playing"; a pre-roll ad shows as unstarted/buffering).
  for (const p of [hana, gabe]) {
    await expect(p.getByTestId("watch-stage")).toHaveAttribute("data-player-state", "1", { timeout: 60_000 });
    await expect.poll(async () => (await ytState(p)).paused, { timeout: 10_000 }).toBe(false);
  }

  // Fullscreen: YouTube's own button is allowed inside its frame, and ours toggles both ways with
  // the other person's camera kept in a corner.
  expect(
    await hana
      .frameLocator('[data-testid="watch-iframe"]')
      .locator("body")
      .evaluate(() => document.fullscreenEnabled),
  ).toBe(true);
  await hana.getByTestId("stage-fullscreen").click();
  await expect.poll(() => hana.evaluate(() => document.fullscreenElement?.getAttribute("data-testid"))).toBe("watch-stage");
  await expect(hana.getByTestId("fullscreen-partner")).toBeVisible();
  await expect(hana.getByRole("button", { name: "Exit full screen" })).toBeVisible();
  await hana.getByTestId("stage-fullscreen").click();
  await expect.poll(() => hana.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(hana.getByTestId("fullscreen-partner")).toHaveCount(0);

  // Hana pauses → Gabe pauses at (about) the same point.
  await ytVideo(hana).evaluate((v: HTMLVideoElement) => v.pause());
  await expect.poll(async () => (await ytState(gabe)).paused, { timeout: 10_000 }).toBe(true);
  const [h1, g1] = [await ytState(hana), await ytState(gabe)];
  expect(Math.abs(h1.t - g1.t)).toBeLessThan(1.5);

  // Gabe skips ahead to 2:00 and plays → Hana follows.
  await ytVideo(gabe).evaluate((v: HTMLVideoElement) => {
    v.currentTime = 120;
    void v.play();
  });
  await expect.poll(async () => (await ytState(hana)).paused, { timeout: 10_000 }).toBe(false);
  await expect.poll(async () => (await ytState(hana)).t, { timeout: 10_000 }).toBeGreaterThan(118);
  await hana.waitForTimeout(3000);
  const [h2, g2] = [await ytState(hana), await ytState(gabe)];
  expect(Math.abs(h2.t - g2.t)).toBeLessThan(1.5);

  // Pinning Gabe turns the video into a thumbnail without reloading it (it keeps playing).
  await hana.getByTestId("tile-remote").hover();
  await hana.getByRole("button", { name: "Pin Gabe" }).click();
  await expect(hana.getByTestId("watch-stage")).toHaveAttribute("data-slot", "thumb");
  const tBefore = (await ytState(hana)).t;
  await hana.waitForTimeout(1500);
  const after = await ytState(hana);
  expect(after.paused).toBe(false);
  expect(after.t).toBeGreaterThan(tBefore);
  await hana.getByRole("button", { name: "Make the video big" }).click();
  await expect(hana.getByTestId("watch-stage")).toHaveAttribute("data-slot", "main");

  // Either person can end it, for both.
  await gabe.getByTestId("watch-end").click();
  await expect(hana.getByTestId("watch-stage")).toHaveCount(0, { timeout: 10_000 });
  await expect(gabe.getByTestId("watch-stage")).toHaveCount(0);
});

test("Watch mode: share a tab with a show, with its sound; the show takes the big spot for the viewer", async ({ browser }) => {
  test.setTimeout(150_000);
  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe", { fakeDisplay: true, fakeDisplayAudio: true });
  const { roomUrl } = await createJoinedRoom(hana, gabe, "Show night");
  await hana.goto(roomUrl);
  await joinCall([hana, gabe]);

  // Hana has Gabe pinned from before.
  await hana.getByTestId("tile-remote").hover();
  await hana.getByRole("button", { name: "Pin Gabe" }).click();
  await expect(stage(hana)).toHaveAttribute("data-main", "them");

  await gabe.getByRole("button", { name: "Share screen" }).click();
  await gabe.getByRole("menuitem", { name: /Watch mode: share a show/ }).click();
  await expect(gabe.getByTestId("watch-share-local")).toBeVisible({ timeout: 10_000 });
  await expect(gabe.getByText("Your show is live for Hana")).toBeVisible();
  await expect(gabe.getByText("No sound is being shared")).toHaveCount(0);

  // For Hana: the show is big (her pin gave way), labelled, playing, with its own volume.
  await expect(stage(hana)).toHaveAttribute("data-main", "content", { timeout: 15_000 });
  await expect(hana.getByText("Gabe is sharing a show 🍿")).toBeVisible();
  await expectVideoPlaying(hana, '[data-testid="share-remote"]');
  await expect(hana.getByRole("slider", { name: "Show volume" })).toBeVisible();
  // The show's sound arrives as its own track (separate from Gabe's voice).
  await expect
    .poll(
      () =>
        hana.evaluate(
          () =>
            Array.from(document.querySelectorAll("audio")).filter(
              (a) => a.srcObject instanceof MediaStream && a.srcObject.getAudioTracks().length > 0,
            ).length,
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(2);
  const peak = await remoteAudioPeak(hana);
  expect(peak).toBeGreaterThan(0.01);

  // Hana can't pause Gabe's tab, so she asks; Gabe is told (chime/notification aside, on his DUO tab too).
  await hana.getByTestId("ask-pause").click();
  await expect(hana.getByTestId("ask-pause")).toHaveText("Asked");
  await expect(gabe.getByTestId("pause-asked")).toHaveText(/Hana asked you to pause/, { timeout: 10_000 });
  await expect(gabe.getByText("Hana asked you to pause ⏸")).toBeVisible();

  // Fullscreen keeps Gabe's face in the corner, and exits again.
  await hana.getByTestId("stage-fullscreen").click();
  await expect(hana.getByTestId("fullscreen-partner")).toBeVisible();
  await hana.getByTestId("stage-fullscreen").click();
  await expect.poll(() => hana.evaluate(() => document.fullscreenElement)).toBeNull();

  // Stopping ends it for both.
  await gabe.getByRole("button", { name: "Stop sharing" }).first().click();
  await expect(hana.getByTestId("share-remote")).toHaveCount(0, { timeout: 10_000 });
});
