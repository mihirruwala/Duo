import { expect, test } from "./fixtures";

test("landing page renders under the strict CSP without errors", async ({ page, watchPage }) => {
  const problems = watchPage(page);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("A private space");
  await expect(page.getByRole("link", { name: /Start a call/ })).toBeVisible();
  await expect(page.getByLabel("Invite code or link")).toBeVisible();

  // Hydration happened (client JS executed under the nonce): the join form validates.
  await page.getByLabel("Invite code or link").fill("not-a-code");
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.locator("#invite-code-error")).toContainText("doesn't look like a DUO invite");

  expect(problems()).toEqual([]);
});

test("protected pages redirect anonymous visitors to sign-in", async ({ page }) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fhome/);
  await page.goto("/r/AAAAAAAAAAAAAAAAAAAAAA");
  await expect(page).toHaveURL(/\/sign-in\?next=/);
});

test("join form routes a pasted invite link to /join with the code in the fragment", async ({ page }) => {
  await page.goto("/");
  const code = "AbCdEfGhIjKlMnOpQrSt_-";
  await page.getByLabel("Invite code or link").fill(`https://duo.example/join#${code}`);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page).toHaveURL(/\/join/);
});

test("public sign-up form creates an account (confirmation on → 'check your inbox'; off → signed in)", async ({ page }) => {
  test.skip(!process.env.SUPABASE_SECRET_KEY, "needs Supabase");
  const email = `duo-e2e-signup-${Date.now()}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Sam");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 10 characters.")).toBeVisible();
  // Regression: a validation error must not wipe what was typed.
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await expect(page.getByLabel("Your name")).toHaveValue("Sam");
  await page.getByLabel("Password").fill("duo-e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your inbox").or(page.getByRole("heading", { name: /Hey Sam/ }))).toBeVisible({
    timeout: 15_000,
  });
  // Clean up the account it created.
  const { adminClient } = await import("./fixtures");
  const admin = adminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const u = data.users.find((x) => x.email === email);
  if (u) await admin.auth.admin.deleteUser(u.id);
});
