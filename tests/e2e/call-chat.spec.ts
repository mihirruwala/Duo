import type { Page } from "@playwright/test";
import { expect, hasBackend, test } from "./fixtures";
import { createJoinedRoom, expectVideoPlaying, newUserPage } from "./helpers";

test.skip(!hasBackend || !process.env.NEXT_PUBLIC_LIVEKIT_URL, "Supabase + LiveKit env required");

async function joinCall(pages: Page[]) {
  for (const p of pages) {
    await p.getByRole("button", { name: "Join call" }).click();
    await expect(p.getByTestId("meeting-room")).toBeVisible({ timeout: 20_000 });
  }
  for (const p of pages) await expectVideoPlaying(p, '[data-testid="tile-remote"]');
}

test("chat during a call: docked beside the video on desktop, opened from the control bar, unread count", async ({ browser }) => {
  test.setTimeout(120_000);
  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe");
  await hana.setViewportSize({ width: 1440, height: 900 });
  await gabe.setViewportSize({ width: 390, height: 844 });
  const { roomUrl } = await createJoinedRoom(hana, gabe, "Chat in call");
  await hana.goto(roomUrl);
  await joinCall([hana, gabe]);

  // No floating chat pill over the video: chat lives in the control bar.
  const hanaChat = hana.getByRole("navigation", { name: "Call controls" }).getByTestId("chat-launcher");
  await expect(hanaChat).toBeVisible();
  await expect(hana.getByTestId("chat-launcher")).toHaveCount(1);

  // Gabe writes while Hana's chat is closed: her Chat button counts it.
  const gabeChat = gabe.getByTestId("chat-launcher");
  await gabeChat.click();
  await expect(gabe.getByTestId("chat-panel")).toBeVisible();
  await gabe.getByTestId("composer").fill("did you see that 😂");
  await gabe.keyboard.press("Enter");
  await expect(hanaChat.getByTestId("unread-badge")).toHaveText("1", { timeout: 10_000 });

  // Opening it docks the chat beside the call; the video moves over instead of being covered.
  await hanaChat.click();
  const panel = hana.getByTestId("chat-panel");
  await expect(panel).toHaveAttribute("data-docked", "");
  await expect(panel.getByText("did you see that 😂")).toBeVisible();
  await hana.waitForTimeout(400); // padding transition
  const panelBox = (await panel.boundingBox())!;
  const remoteBox = (await hana.getByTestId("tile-remote").boundingBox())!;
  const controlsBox = (await hana.getByRole("navigation", { name: "Call controls" }).boundingBox())!;
  expect(panelBox.height).toBeGreaterThan(880); // full height
  expect(remoteBox.x + remoteBox.width).toBeLessThanOrEqual(panelBox.x + 1);
  expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(panelBox.x + 1);
  await expect(hanaChat).toHaveAttribute("aria-pressed", "true");

  // On the phone, chat takes the screen and closes back to the call.
  await expect(gabe.getByTestId("chat-panel")).toHaveAttribute("data-docked", "");
  const phonePanel = (await gabe.getByTestId("chat-panel").boundingBox())!;
  expect(phonePanel.width).toBeGreaterThanOrEqual(389);
  await gabe.getByTestId("chat-panel").getByRole("button", { name: "Close chat" }).click();
  await expect(gabe.getByTestId("chat-panel")).toHaveCount(0);
  await expectVideoPlaying(gabe, '[data-testid="tile-remote"]');

  // Closing on desktop gives the call its full width back.
  await hanaChat.click();
  await expect(hana.getByTestId("chat-panel")).toHaveCount(0);
  await hana.waitForTimeout(400);
  const fullControls = (await hana.getByRole("navigation", { name: "Call controls" }).boundingBox())!;
  expect(fullControls.x + fullControls.width / 2).toBeGreaterThan(700); // centred again
});
