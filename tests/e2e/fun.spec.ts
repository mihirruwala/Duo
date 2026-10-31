import { expect, hasBackend, test } from "./fixtures";
import { createJoinedRoom, expectVideoPlaying, newUserPage } from "./helpers";

test.skip(!hasBackend || !process.env.NEXT_PUBLIC_LIVEKIT_URL, "Supabase + LiveKit env required");

test("in-call fun: floating reactions for both, photo booth with shared countdown → chat + Moments", async ({ browser }) => {
  test.setTimeout(150_000);
  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(hana, gabe, "Fun test");
  await hana.goto(roomUrl);
  for (const p of [hana, gabe]) {
    await p.getByRole("button", { name: "Join call" }).click();
    await expect(p.getByTestId("meeting-room")).toBeVisible({ timeout: 20_000 });
  }
  await expectVideoPlaying(hana, '[data-testid="tile-remote"]');
  await expectVideoPlaying(gabe, '[data-testid="tile-remote"]');

  // Reaction: floats on both screens, labelled with who sent it.
  await hana.getByRole("button", { name: "Send a reaction" }).click();
  await hana.getByRole("button", { name: "React ❤️" }).click();
  await expect(hana.getByTestId("floating-reaction").filter({ hasText: "You" })).toBeVisible();
  await expect(gabe.getByTestId("floating-reaction").filter({ hasText: "❤️" }).filter({ hasText: "Hana" })).toBeVisible({
    timeout: 5_000,
  });
  await hana.keyboard.press("Escape");

  // Booth, cancelled by the other person: nothing is taken.
  await hana.getByRole("button", { name: "Photo booth" }).click();
  await expect(gabe.getByTestId("booth-countdown")).toBeVisible({ timeout: 5_000 });
  await gabe.getByTestId("booth-countdown").getByRole("button", { name: "Cancel" }).click();
  await expect(hana.getByTestId("booth-countdown")).toHaveCount(0, { timeout: 5_000 });
  await hana.waitForTimeout(3500);

  // Booth for real: both see the countdown, the photo lands in chat for both and in Moments.
  await hana.getByRole("button", { name: "Photo booth" }).click();
  await expect(hana.getByTestId("booth-countdown")).toBeVisible();
  await expect(gabe.getByTestId("booth-countdown")).toBeVisible({ timeout: 5_000 });
  await expect(hana.getByText("Saved to Moments ✨")).toBeVisible({ timeout: 20_000 });
  for (const p of [hana, gabe]) {
    const launcher = p.getByTestId("chat-launcher");
    if (await launcher.isVisible()) await launcher.click();
    await expect(p.getByTestId("chat-image")).toHaveCount(1, { timeout: 15_000 });
    await expect
      .poll(() => p.getByTestId("chat-image").evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15_000 })
      .toBe(1600);
    await p.getByRole("tab", { name: "Moments" }).click();
    await expect(p.getByTestId("moments-grid").getByRole("button", { name: /Open/ })).toHaveCount(1, { timeout: 10_000 });
  }
});
