import { expect, hasBackend, test } from "./fixtures";
import { createJoinedRoom, newUserPage } from "./helpers";

// Requires a Supabase project with "Confirm email" disabled (see README → Testing).
test.skip(!hasBackend, "Supabase env not configured. Skipping backend e2e");

test("host creates a private room, guest joins by invite, a third person is locked out", async ({ browser }) => {
  const host = await newUserPage(browser, "Hana");
  const guest = await newUserPage(browser, "Gabe");

  const { roomUrl, inviteUrl } = await createJoinedRoom(host, guest);
  expect(inviteUrl).toMatch(/\/join#[A-Za-z0-9_-]{22}$/);
  await expect(guest.getByTestId("room-members")).toContainText("Hana");
  await expect(guest.getByTestId("room-members")).toContainText("Gabe");
  await host.reload();
  await expect(host.getByTestId("room-members")).toContainText("Gabe");

  // Third person: the used invite is dead, and the room URL reveals nothing.
  const outsider = await newUserPage(browser, "Otto");
  const invite = new URL(inviteUrl);
  await outsider.goto(invite.pathname + invite.hash);
  await expect.poll(() => new URL(outsider.url()).hash).toBe("");
  await outsider.getByRole("button", { name: "Join room" }).click();
  await expect(outsider.getByText("That invite isn't valid anymore")).toBeVisible();
  await outsider.goto(roomUrl);
  await expect(outsider.getByTestId("room-not-found")).toBeVisible();

  // A guessed room id looks exactly the same as a real one you can't access.
  await outsider.goto("/r/AAAAAAAAAAAAAAAAAAAAAA");
  await expect(outsider.getByTestId("room-not-found")).toBeVisible();
});
