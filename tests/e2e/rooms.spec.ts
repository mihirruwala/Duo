import type { Browser, Page } from "@playwright/test";
import { expect, hasBackend, test } from "./fixtures";

// Requires a Supabase project with "Confirm email" disabled (see README → Testing).
test.skip(!hasBackend, "Supabase env not configured. Skipping backend e2e");

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = "duo-e2e-password-123";

async function signUp(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(`duo-e2e-${name.toLowerCase()}-${run}@example.com`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/home$/);
  return page;
}

test("host creates a private room, guest joins by invite, a third person is locked out", async ({ browser }) => {
  // Host
  const host = await signUp(browser, "Hana");
  await host.getByRole("button", { name: "New room" }).first().click();
  await host.getByLabel("Room name").fill("E2E hangout");
  await host.getByRole("button", { name: "Create room" }).click();
  const inviteUrl = await host.getByTestId("invite-link").inputValue();
  expect(inviteUrl).toMatch(/\/join#[A-Za-z0-9_-]{22}$/);
  await host.getByRole("link", { name: /Enter room/ }).click();
  await expect(host.getByTestId("room-name")).toHaveText("E2E hangout");
  const roomUrl = host.url();
  expect(roomUrl).toMatch(/\/r\/[A-Za-z0-9_-]{22}$/);

  // Guest (second, isolated browser session)
  const guest = await signUp(browser, "Gabe");
  await guest.goto(new URL(inviteUrl).pathname + new URL(inviteUrl).hash);
  await expect(guest.getByRole("heading", { name: "You're invited" })).toBeVisible();
  // The secret is stripped from the address bar.
  await expect.poll(() => new URL(guest.url()).hash).toBe("");
  await guest.getByRole("button", { name: "Join room" }).click();
  await expect(guest).toHaveURL(roomUrl);
  await expect(guest.getByTestId("room-members")).toContainText("Hana");
  await expect(guest.getByTestId("room-members")).toContainText("Gabe");

  await host.reload();
  await expect(host.getByTestId("room-members")).toContainText("Gabe");

  // Third person: the used invite is dead, and the room URL reveals nothing.
  const outsider = await signUp(browser, "Otto");
  await outsider.goto(new URL(inviteUrl).pathname + new URL(inviteUrl).hash);
  await outsider.getByRole("button", { name: "Join room" }).click();
  await expect(outsider.getByText("That invite isn't valid anymore")).toBeVisible();
  await outsider.goto(roomUrl);
  await expect(outsider.getByTestId("room-not-found")).toBeVisible();

  // Guessed room id looks exactly the same as a real one you can't access.
  await outsider.goto("/r/AAAAAAAAAAAAAAAAAAAAAA");
  await expect(outsider.getByTestId("room-not-found")).toBeVisible();
});
