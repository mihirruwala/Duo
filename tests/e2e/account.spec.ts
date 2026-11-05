import { adminClient, expect, hasBackend, test } from "./fixtures";
import { emailOf, newUserPage, PASSWORD } from "./helpers";

test.skip(!hasBackend, "Supabase env required");

const NEW_PASSWORD = "a-brand-new-password-42";

test("forgot password: the emailed link works on any device and sets a new password", async ({ browser }) => {
  test.setTimeout(90_000);
  const owner = await newUserPage(browser, "Hana");
  const email = emailOf(owner);
  await owner.context().close();

  // Sign-in links to the reset page.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();

  // The link from the email, generated exactly as Supabase would (no inbox needed). Opened in a
  // fresh browser context, like a phone opening the email: it must still work.
  const { data, error } = await adminClient().auth.admin.generateLink({ type: "recovery", email });
  expect(error).toBeNull();
  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto(`/auth/confirm?token_hash=${data.properties!.hashed_token}&type=recovery`);
  await expect(fresh).toHaveURL(/\/reset-password$/);
  await expect(fresh.getByText(email)).toBeVisible();

  await fresh.getByLabel("New password").fill("short");
  await fresh.getByLabel("Repeat it").fill("short");
  await fresh.getByRole("button", { name: "Save new password" }).click();
  await expect(fresh.getByRole("alert").filter({ hasText: "Use at least 10 characters." })).toBeVisible();
  await fresh.getByLabel("New password").fill(NEW_PASSWORD);
  await fresh.getByLabel("Repeat it").fill(NEW_PASSWORD + "x");
  await fresh.getByRole("button", { name: "Save new password" }).click();
  await expect(fresh.getByRole("alert").filter({ hasText: "The two passwords don't match." })).toBeVisible();
  await fresh.getByLabel("Repeat it").fill(NEW_PASSWORD);
  await fresh.getByRole("button", { name: "Save new password" }).click();
  await expect(fresh).toHaveURL(/\/home$/, { timeout: 15_000 });

  // The link is single-use.
  await page.goto(`/auth/confirm?token_hash=${data.properties!.hashed_token}&type=recovery`);
  await expect(page).toHaveURL(/\/forgot-password\?error=link$/);
  await expect(page.getByRole("alert").filter({ hasText: "expired or was already used" })).toBeVisible();

  // Old password no longer works, the new one does.
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Wrong email or password." })).toBeVisible();
  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 15_000 });
  await context.close();
});

test("a broken or expired email link explains itself instead of failing silently", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=not-a-real-token&type=email");
  await expect(page).toHaveURL(/\/sign-in\?error=link$/);
  await expect(page.getByRole("alert").filter({ hasText: "expired or was already used" })).toBeVisible();
  await page.goto("/reset-password");
  await expect(page).toHaveURL(/\/forgot-password\?error=link$/);
});

test("settings: change password needs the current one", async ({ browser }) => {
  test.setTimeout(90_000);
  const page = await newUserPage(browser, "Gabe");
  const email = emailOf(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Change password" }).click();
  await page.getByLabel("Current password").fill("not-my-password");
  await page.getByLabel("New password").fill(NEW_PASSWORD);
  await page.getByLabel("Repeat it").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Your current password isn't right." })).toBeVisible();
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Password changed.")).toBeVisible();

  const other = await (await browser.newContext()).newPage();
  await other.goto("/sign-in");
  await other.getByLabel("Email").fill(email);
  await other.getByLabel("Password").fill(NEW_PASSWORD);
  await other.getByRole("button", { name: "Sign in" }).click();
  await expect(other).toHaveURL(/\/home$/, { timeout: 15_000 });
});

test("search engines see the public pages only; links get a preview card", async ({ page, request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /r/");
  expect(robots).toContain("Disallow: /home");
  expect(robots).toMatch(/Sitemap: https?:\/\/.+\/sitemap\.xml/);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/privacy</loc>");

  await page.goto("/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(og).toMatch(/\/opengraph-image/);
  const img = await request.get(new URL(og!).pathname);
  expect(img.headers()["content-type"]).toContain("image/png");

  await page.goto("/join");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});
