import type { Page } from "@playwright/test";
import { expect, hasBackend, test } from "./fixtures";
import { expectVideoPlaying, newUserPage, remoteAudioPeak, pressJoinCall } from "./helpers";

test.skip(!hasBackend || !process.env.NEXT_PUBLIC_LIVEKIT_URL, "Supabase + LiveKit env required");

/** Host creates a room and stays on its page; returns the invite URL (the guest hasn't joined yet). */
async function createRoomAndWait(host: Page, name: string) {
  await host.getByRole("button", { name: "New room" }).first().click();
  await host.getByLabel("Room name").fill(name);
  await host.getByRole("button", { name: "Create room" }).click();
  const inviteUrl = await host.getByTestId("invite-link").inputValue();
  await host.getByRole("link", { name: /Enter room/ }).click();
  await expect(host).toHaveURL(/\/r\/[A-Za-z0-9_-]{22}$/);
  return new URL(inviteUrl);
}

async function acceptInvite(guest: Page, invite: URL) {
  await guest.goto(invite.pathname + invite.hash);
  await guest.getByRole("button", { name: "Join room" }).click();
  await expect(guest).toHaveURL(/\/r\//);
}

test("a host waiting in a new room sees their person arrive, without reloading", async ({ browser }) => {
  test.setTimeout(90_000);
  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe");
  const invite = await createRoomAndWait(hana, "First date");
  await expect(hana.getByTestId("room-members")).toContainText("Waiting for your person");

  await acceptInvite(gabe, invite);
  await expect(hana.getByTestId("room-members")).toContainText("Gabe", { timeout: 15_000 });
  await expect(hana.getByText(/Gabe is here in the room/)).toBeVisible({ timeout: 15_000 });
});

test("a host already in the call sees and hears the guest who just accepted the invite", async ({ browser }) => {
  test.setTimeout(120_000);
  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe");
  const invite = await createRoomAndWait(hana, "Waiting in the call");
  await hana.getByRole("button", { name: "Join call" }).click();
  await expect(hana.getByTestId("meeting-room")).toBeVisible({ timeout: 20_000 });
  await expect(hana.getByTestId("waiting-tile")).toBeVisible();

  // Gabe is on a phone: small screen, and (like Android/iOS browsers) no screen capture API.
  await gabe.addInitScript(() => {
    delete (MediaDevices.prototype as { getDisplayMedia?: unknown }).getDisplayMedia;
  });
  await gabe.setViewportSize({ width: 390, height: 844 });
  await acceptInvite(gabe, invite);
  await pressJoinCall(gabe);
  await expect(gabe.getByTestId("meeting-room")).toBeVisible({ timeout: 20_000 });

  await expectVideoPlaying(hana, '[data-testid="tile-remote"]');
  await expectVideoPlaying(gabe, '[data-testid="tile-remote"]');
  expect(await remoteAudioPeak(hana)).toBeGreaterThan(0.01);
  expect(await remoteAudioPeak(gabe)).toBeGreaterThan(0.01);
  await expect(hana.getByTestId("tile-remote")).toContainText("Gabe");

  // On the phone, Hana fills the screen and Gabe's own camera floats in a corner; desktop stays side by side.
  await expect(gabe.getByTestId("call-stage")).toHaveAttribute("data-main", "them");
  await expect(gabe.getByTestId("tile-local")).toHaveAttribute("data-slot", "float");
  await expect(hana.getByTestId("call-stage")).toHaveAttribute("data-layout", "duo");
  // Phones can't share a screen from a web page, so there's no Share button there.
  await expect(gabe.getByRole("button", { name: "Share screen" })).toHaveCount(0);
  await gabe.screenshot({ path: "test-results/phone-call.png" });
});
