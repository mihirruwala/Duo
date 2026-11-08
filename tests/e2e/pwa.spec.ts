import { expect, test } from "./fixtures";

test("DUO is installable: manifest, icons, and an offline page when the connection drops", async ({ page, request, context }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "DUO", start_url: "/home", display: "standalone" });
  expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toEqual(expect.arrayContaining(["any", "maskable"]));
  for (const icon of manifest.icons) {
    const img = await request.get(icon.src);
    expect(img.headers()["content-type"]).toContain("image/png");
  }

  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  // The service worker takes over, then the connection drops: opening a page shows DUO's offline screen.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.goto("/privacy").catch(() => undefined);
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("link", { name: "Try again" }).click();
  await expect(page).not.toHaveURL(/offline/);
});
