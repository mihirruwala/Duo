import type { Page } from "@playwright/test";
import { adminClient, expect, hasBackend, test } from "./fixtures";
import { createJoinedRoom, emailOf, newUserPage, PASSWORD } from "./helpers";

test.skip(!hasBackend, "Supabase env required");

async function uploadFile(page: Page, name: string) {
  const panel = page.getByTestId("chat-panel");
  const launcher = page.getByTestId("chat-launcher");
  await expect(panel.or(launcher)).toBeVisible();
  if (await launcher.isVisible()) await launcher.click();
  await expect(panel).toBeVisible();
  await page.getByTestId("file-input").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(`hello from ${name}`) });
  await expect(page.locator('[data-testid="chat-message"][data-status="sent"]').filter({ hasText: name })).toBeVisible({
    timeout: 20_000,
  });
}

async function roomIdFor(roomUrl: string) {
  const slug = new URL(roomUrl).pathname.split("/").pop()!;
  const { data } = await adminClient().from("rooms").select("id").eq("slug", slug).maybeSingle();
  return data?.id as string | undefined;
}

async function storedFiles(roomId: string) {
  const storage = adminClient().storage.from("attachments");
  const { data: folders } = await storage.list(roomId);
  let n = 0;
  for (const f of folders ?? []) n += (await storage.list(`${roomId}/${f.name}`)).data?.length ?? 0;
  return n;
}

test("profile settings, room deletion removes files, account deletion needs your password and cleans up", async ({ browser }) => {
  test.setTimeout(180_000);
  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe");

  // Room A: Hana hosts, with a file in it.
  const a = await createJoinedRoom(hana, gabe, "Room A");
  await hana.goto(a.roomUrl);
  await uploadFile(hana, "a-notes.txt");
  const roomA = (await roomIdFor(a.roomUrl))!;
  await expect.poll(() => storedFiles(roomA)).toBe(1);

  // Profile: rename + recolour; Gabe sees the new name.
  await hana.goto("/settings");
  await hana.getByLabel("Name").fill("Hana B.");
  await hana.getByRole("button", { name: "Save changes" }).click();
  await expect(hana.getByText("Profile saved")).toBeVisible();
  await gabe.goto(a.roomUrl);
  await expect(gabe.getByTestId("room-members")).toContainText("Hana B.");
  await expect(hana.getByLabel("Name")).toHaveValue("Hana B.");
  await hana.getByLabel("Name").fill("");
  await hana.getByRole("button", { name: "Save changes" }).click();
  await expect(hana.getByText("Your name can't be empty.")).toBeVisible();

  // Host deletes Room A → its stored files are gone too.
  await hana.goto(a.roomUrl);
  await hana.getByRole("button", { name: "Delete room" }).click();
  await hana.getByRole("dialog").getByRole("button", { name: "Delete room" }).click();
  await expect(hana).toHaveURL(/\/home$/, { timeout: 20_000 });
  await expect.poll(() => storedFiles(roomA), { timeout: 15_000 }).toBe(0);
  expect(await roomIdFor(a.roomUrl)).toBeUndefined();

  // Room B: Gabe hosts; Hana shares a file there.
  await gabe.goto("/home");
  const b = await createJoinedRoom(gabe, hana, "Room B");
  await hana.goto(b.roomUrl);
  await uploadFile(hana, "b-from-hana.txt");
  const roomB = (await roomIdFor(b.roomUrl))!;
  await expect.poll(() => storedFiles(roomB)).toBe(1);

  // Account deletion: wrong password refused; right password deletes and cleans up.
  await hana.goto("/settings");
  await hana.getByTestId("delete-account").click();
  await hana.getByLabel("Your password").fill("not-my-password");
  await hana.getByLabel(/Type DELETE/).fill("DELETE");
  await hana.getByRole("button", { name: "Delete forever" }).click();
  await expect(hana.getByText("That password isn't right.")).toBeVisible();
  await hana.getByLabel("Your password").fill(PASSWORD);
  await hana.getByRole("button", { name: "Delete forever" }).click();
  await expect(hana).toHaveURL(/\/\?deleted=1$/, { timeout: 20_000 });

  // Hana's file in Gabe's room is gone; Gabe's room itself survives, now with one member.
  await expect.poll(() => storedFiles(roomB), { timeout: 15_000 }).toBe(0);
  expect(await roomIdFor(b.roomUrl)).toBeDefined();
  await gabe.goto(b.roomUrl);
  await expect(gabe.getByTestId("room-members")).not.toContainText("Hana");

  // And the account can't sign in any more.
  await hana.goto("/sign-in");
  await hana.getByLabel("Email").fill(emailOf(hana));
  await hana.getByLabel("Password").fill(PASSWORD);
  await hana.getByRole("button", { name: "Sign in" }).click();
  await expect(hana.getByText("Wrong email or password.")).toBeVisible({ timeout: 15_000 });
});
