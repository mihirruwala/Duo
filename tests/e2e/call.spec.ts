import { expect, hasBackend, test } from "./fixtures";
import { createJoinedRoom, expectVideoPlaying, newUserPage, remoteAudioPeak } from "./helpers";

const hasLivekit = Boolean(process.env.NEXT_PUBLIC_LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);

test.skip(!hasBackend || !hasLivekit, "Supabase + LiveKit env required");

/**
 * M2 gate: two sessions see and hear each other and share a screen; uninvited users
 * can't obtain a media token. Chrome's fake camera/mic stand in for real devices.
 */
test("two people see and hear each other, share a screen, and leave cleanly", async ({ browser, watchPage }) => {
  test.setTimeout(150_000);
  const host = await newUserPage(browser, "Hana", { fakeDisplay: true });
  const guest = await newUserPage(browser, "Gabe");
  const hostProblems = watchPage(host);
  const { roomUrl } = await createJoinedRoom(host, guest, "Call test");
  await host.goto(roomUrl);

  // Pre-call studio: live preview + working mic meter on both sides.
  for (const page of [host, guest]) {
    await expectVideoPlaying(page, "body");
    await expect
      .poll(() => page.getByTestId("mic-level").getAttribute("data-level").then(Number), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Join call" }).click();
    await expect(page.getByTestId("meeting-room")).toBeVisible();
  }

  // Both see each other's video…
  await expectVideoPlaying(host, '[data-testid="tile-remote"]');
  await expectVideoPlaying(guest, '[data-testid="tile-remote"]');
  await expect(host.getByTestId("tile-remote")).toContainText("Gabe");
  await expect(guest.getByTestId("tile-remote")).toContainText("Hana");

  // …and hear each other: decoded remote audio carries real signal on both sides.
  await expect(guest.locator("audio")).toHaveCount(1);
  await expect(host.locator("audio")).toHaveCount(1);
  await expect.poll(() => remoteAudioPeak(host), { timeout: 20_000 }).toBeGreaterThan(0.01);
  await expect.poll(() => remoteAudioPeak(guest), { timeout: 20_000 }).toBeGreaterThan(0.01);

  // Mute is reflected on the other side.
  await host.getByRole("button", { name: "Mute" }).click();
  await expect(guest.getByTestId("tile-remote").getByLabel("Microphone off")).toBeVisible();
  await host.getByRole("button", { name: "Unmute" }).click();
  await expect(guest.getByTestId("tile-remote").getByLabel("Microphone off")).toHaveCount(0);

  // Live device switching mid-call: pick another microphone; the other side keeps hearing.
  await host.getByRole("button", { name: "Choose microphone and speaker" }).click();
  const mics = host.getByRole("menuitem");
  await expect(mics.first()).toBeVisible();
  expect(await mics.count()).toBeGreaterThan(1);
  await mics.nth(1).click();
  await expect.poll(() => remoteAudioPeak(guest), { timeout: 20_000 }).toBeGreaterThan(0.01);

  // Network drop: the guest shows "Reconnecting…", then recovers by itself with video intact.
  await guest.context().setOffline(true);
  await expect(guest.getByTestId("connection-state")).toContainText("Reconnecting", { timeout: 20_000 });
  await guest.context().setOffline(false);
  await expect(guest.getByTestId("connection-state")).toContainText("Connected", { timeout: 30_000 });
  await expectVideoPlaying(guest, '[data-testid="tile-remote"]');

  // Screen share appears live on the other side.
  await host.getByRole("button", { name: "Share screen" }).click();
  await host.getByRole("menuitem", { name: /Share screen, window or tab/ }).click();
  await expect(guest.getByTestId("share-remote")).toContainText("Hana is sharing their screen");
  await expectVideoPlaying(guest, '[data-testid="share-remote"]');
  await expect(host.getByTestId("share-local")).toContainText("You are sharing your screen");
  // While Hana shares, Gabe's share button is blocked.
  await expect(guest.getByRole("button", { name: "Hana is sharing" })).toBeDisabled();

  // Stop from the browser's native control (the track ends) → both sides update.
  await host.evaluate(() => {
    const streams = (window as unknown as { __duoDisplayStreams: MediaStream[] }).__duoDisplayStreams;
    for (const s of streams)
      for (const t of s.getTracks()) {
        t.stop();
        t.dispatchEvent(new Event("ended"));
      }
  });
  await expect(guest.getByTestId("share-remote")).toHaveCount(0, { timeout: 15_000 });
  await expect(host.getByRole("button", { name: "Share screen" })).toBeVisible();

  // Share again, then stop from the in-app control.
  await host.getByRole("button", { name: "Share screen" }).click();
  await host.getByRole("menuitem", { name: /Share screen, window or tab/ }).click();
  await expect(guest.getByTestId("share-remote")).toBeVisible();
  await host.getByRole("button", { name: "Stop sharing" }).first().click();
  await expect(guest.getByTestId("share-remote")).toHaveCount(0, { timeout: 15_000 });

  // Guest leaves → host sees "left"; guest's camera is released.
  await guest.getByRole("button", { name: "Leave call" }).click();
  await expect(guest.getByTestId("call-ended")).toContainText("You left the call");
  await expect(host.getByTestId("waiting-tile")).toContainText("Gabe left the call", { timeout: 20_000 });
  const liveTracks = await guest.evaluate(async () => {
    // Every <video> on the page is gone or has ended tracks.
    return Array.from(document.querySelectorAll("video")).flatMap((v) =>
      v.srcObject instanceof MediaStream ? v.srcObject.getTracks().filter((t) => t.readyState === "live") : [],
    ).length;
  });
  expect(liveTracks).toBe(0);

  expect(hostProblems().filter((p) => !/Failed to load resource/.test(p))).toEqual([]);
});

test("media tokens are only issued to room members", async ({ browser, playwright, baseURL }) => {
  const host = await newUserPage(browser, "Hana");
  const guest = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(host, guest, "Token test");
  const slug = new URL(roomUrl).pathname.split("/").pop()!;
  const tokenPath = `/api/rooms/${slug}/token`;

  // Member: gets a token.
  const ok = await host.request.post(tokenPath, { headers: { "sec-fetch-site": "same-origin" } });
  expect(ok.status()).toBe(200);
  const body = (await ok.json()) as { token: string; url: string };
  const claims = JSON.parse(Buffer.from(body.token.split(".")[1]!, "base64url").toString()) as {
    sub: string;
    exp: number;
    nbf?: number;
    video: { room: string; roomJoin: boolean; roomAdmin?: boolean; roomRecord?: boolean };
  };
  expect(claims.video.roomJoin).toBe(true);
  expect(claims.video.roomAdmin).toBeFalsy();
  expect(claims.video.roomRecord).toBeFalsy();
  expect(claims.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(600);

  // Signed-in outsider: same 404 as a nonexistent room.
  const outsider = await newUserPage(browser, "Otto");
  const denied = await outsider.request.post(tokenPath, { headers: { "sec-fetch-site": "same-origin" } });
  expect(denied.status()).toBe(404);
  const guessed = await outsider.request.post("/api/rooms/AAAAAAAAAAAAAAAAAAAAAA/token", {
    headers: { "sec-fetch-site": "same-origin" },
  });
  expect(guessed.status()).toBe(404);

  // Anonymous: 401.
  const anon = await playwright.request.newContext({ baseURL });
  expect((await anon.post(tokenPath, { headers: { "sec-fetch-site": "same-origin" } })).status()).toBe(401);

  // Cross-site request with the member's cookies (CSRF): refused.
  const csrf = await host.request.post(tokenPath, {
    headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
  });
  expect(csrf.status()).toBe(403);
});
