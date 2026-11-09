import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createJoinedRoom, newUserPage } from "./helpers";

/** iPhone-size screenshots of every main screen, for design review. Off by default: DUO_PHONE_AUDIT=<dir>. */
const OUT = process.env.DUO_PHONE_AUDIT;
test.skip(!OUT, "Only when reviewing the phone layout");

const shot = (p: Page, name: string) => p.screenshot({ path: `${OUT}/${name}.png` });

test("phone audit", async ({ browser }) => {
  test.setTimeout(240_000);
  const hana = await newUserPage(browser, "Hana", { phone: true });
  const gabe = await newUserPage(browser, "Gabe");
  await hana.setViewportSize({ width: 390, height: 844 });
  await shot(hana, "01-home-empty");
  const { roomUrl } = await createJoinedRoom(hana, gabe, "Movie night");
  await hana.goto("/home");
  await hana.waitForTimeout(1500);
  await shot(hana, "02-home");

  // Gabe says hi from his computer.
  await gabe.goto(roomUrl);
  const launcher = gabe.getByTestId("chat-launcher");
  if (await launcher.isVisible()) await launcher.click();
  for (const t of ["are you on? 🙂", "I'm making tea, join when ready"]) {
    await gabe.getByTestId("composer").fill(t);
    await gabe.getByTestId("composer").press("Enter");
    await gabe.waitForTimeout(300);
  }

  // Hana's room screen is the chat.
  await hana.getByTestId("room-card").first().click();
  await expect(hana.getByTestId("room-info-button")).toBeVisible({ timeout: 15_000 });
  await hana.waitForTimeout(1500);
  await shot(hana, "03-room-chat");
  await hana.getByTestId("composer").fill("on my way!");
  await hana.getByTestId("composer").press("Enter");
  await hana.waitForTimeout(600);
  await shot(hana, "04-room-chat-sent");
  await hana.getByRole("tab", { name: "Lists" }).click();
  await hana.waitForTimeout(400);
  await shot(hana, "05-lists");
  await hana.getByRole("tab", { name: "Chat" }).click();
  await hana.getByTestId("room-info-button").click();
  await hana.waitForTimeout(500);
  await shot(hana, "06-room-info");
  await hana.getByRole("button", { name: "Close movie night" }).click();

  // Call sheet, then the call.
  await hana.getByTestId("phone-call-button").click();
  await expect(hana.getByTestId("call-sheet")).toBeVisible();
  await hana.waitForTimeout(2000);
  await shot(hana, "07-call-sheet");
  await hana.getByRole("button", { name: "Join call" }).click();
  await gabe.evaluate(() => localStorage.setItem("duo.chatDock.v1", JSON.stringify({ open: false })));
  await gabe.goto(roomUrl);
  await gabe.getByRole("button", { name: "Join call" }).click();
  await expect(hana.getByTestId("tile-remote")).toBeVisible({ timeout: 20_000 });
  await hana.waitForTimeout(1500);
  await shot(hana, "08-call");
  await hana.getByRole("button", { name: "More" }).click();
  await hana.waitForTimeout(400);
  await shot(hana, "09-call-more");
  await hana.keyboard.press("Escape");
  await hana.waitForTimeout(6500);
  await shot(hana, "10-call-controls-hidden");
  await hana.getByRole("button", { name: "Leave call" }).click({ force: true });
  await hana.waitForTimeout(1000);
  await shot(hana, "11-after-leave");

  await hana.goto("/settings");
  await hana.waitForTimeout(1500);
  await shot(hana, "12-settings");
});
