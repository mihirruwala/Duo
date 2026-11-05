import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createJoinedRoom, newUserPage } from "./helpers";

/**
 * Chrome Web Store screenshots of the app (see docs/CHROME_WEB_STORE.md). Off by default:
 *   DUO_STORE_SHOTS=1 npx playwright test tests/e2e/store-shots.spec.ts
 * Cameras are off on purpose: the fake test camera is a neon pattern, and avatars show the real UI.
 */
test.skip(!process.env.DUO_STORE_SHOTS, "Only when regenerating store screenshots");

const RAW = `${process.cwd()}/extension/store-assets/out/raw`;

async function joinCamOff(p: Page) {
  await p.getByRole("button", { name: "Turn off camera" }).click();
  await p.getByRole("button", { name: "Join call" }).click();
  await expect(p.getByTestId("connection-state")).toHaveAttribute("data-state", "connected", { timeout: 20_000 });
}

test("store screenshots of the app", async ({ browser }) => {
  test.setTimeout(240_000);
  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe");
  await hana.setViewportSize({ width: 1280, height: 720 });
  const { roomUrl } = await createJoinedRoom(hana, gabe, "Movie night");
  await hana.goto(roomUrl);
  await joinCamOff(hana);
  await joinCamOff(gabe);
  await expect(hana.getByTestId("tile-remote")).toBeVisible();

  // A short, real conversation in the docked chat.
  await gabe.getByTestId("chat-launcher").click();
  await hana.getByTestId("chat-launcher").click();
  const say = async (p: Page, text: string) => {
    await p.getByTestId("composer").fill(text);
    await p.getByTestId("composer").press("Enter");
    await p.waitForTimeout(400);
  };
  await say(gabe, "popcorn ready? 🍿");
  await say(hana, "two minutes, making tea");
  await gabe.getByRole("button", { name: "Stickers" }).click();
  await gabe.getByRole("button", { name: /Send sticker: Two blobs hugging/ }).click();
  await gabe.waitForTimeout(400);
  await hana.getByTestId("record-voice").click();
  await hana.waitForTimeout(3200);
  await hana.getByTestId("recording-send").click();
  await say(gabe, "ok I added Big Buck Bunny to our list, watch that first?");
  await expect(hana.getByTestId("chat-message").filter({ has: hana.getByTestId("voice-note") })).toHaveAttribute(
    "data-status",
    "sent",
    { timeout: 20_000 },
  );
  await hana.waitForTimeout(1500);
  await hana.screenshot({ path: `${RAW}/app-call-chat.png` });

  // Watch Together.
  await hana.getByTestId("chat-launcher").click();
  await hana.getByRole("button", { name: "Watch together" }).click();
  await hana.getByLabel("YouTube link").fill("https://youtu.be/aqz-KE-bpKQ?t=60");
  await hana.getByRole("button", { name: "Start" }).click();
  await expect(hana.getByTestId("watch-stage")).toHaveAttribute("data-player-state", "1", { timeout: 60_000 });
  const tip = hana.getByRole("button", { name: "Dismiss tip" });
  if (await tip.isVisible()) await tip.click();
  await hana.mouse.move(5, 5);
  await hana.waitForTimeout(4000); // let YouTube's controls fade
  await hana.screenshot({ path: `${RAW}/app-watch.png` });
});
