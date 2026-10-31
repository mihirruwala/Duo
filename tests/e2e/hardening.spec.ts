import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { adminClient, expect, hasBackend, test } from "./fixtures";
import { createJoinedRoom, newUserPage } from "./helpers";

test.skip(!hasBackend, "Supabase env required");

const XSS = [
  `<img src=x onerror="window.__pwned=1">`,
  `<script>window.__pwned=1</script>`,
  `javascript:window.__pwned=1`,
  `[click](javascript:window.__pwned=1)`,
  `<a href="javascript:window.__pwned=1">click</a>`,
  `<svg onload="window.__pwned=1">`,
];

test("hostile content renders as text: chat bodies, links and display names can't run script", async ({ browser }) => {
  test.setTimeout(120_000);
  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(hana, gabe, "XSS test");

  // A display name full of markup (set through the same RLS-guarded API the app uses).
  const { data: users } = await adminClient().auth.admin.listUsers({ perPage: 200 });
  const gabeId = users.users.find((u) => u.user_metadata?.display_name === "Gabe" && u.email?.includes("duo-e2e-gabe"))!.id;
  await adminClient().from("profiles").update({ display_name: `<img src=x onerror="window.__pwned=1">` }).eq("id", gabeId);

  await gabe.goto(roomUrl);
  await gabe.getByTestId("chat-launcher").click();
  for (const payload of XSS) {
    await gabe.getByTestId("composer").fill(payload);
    await gabe.getByTestId("composer").press("Enter");
  }
  await gabe.getByTestId("composer").fill("safe link https://example.com/ok and http://evil.example/");
  await gabe.getByTestId("composer").press("Enter");

  await hana.goto(roomUrl);
  await hana.getByTestId("chat-launcher").click();
  // Several payloads share substrings, so check each is present (at least once) as literal text.
  for (const payload of XSS) {
    await expect(hana.getByTestId("chat-message").filter({ hasText: payload }).first()).toBeVisible({ timeout: 15_000 });
  }
  await expect(hana.getByTestId("room-members")).toContainText(`<img src=x onerror="window.__pwned=1">`);

  expect(await hana.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(await gabe.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  // No element from user content made it into the DOM.
  expect(
    await hana
      .locator(
        '[data-testid="chat-message"] img[src="x"], [data-testid="chat-message"] script, [data-testid="chat-message"] svg[onload]',
      )
      .count(),
  ).toBe(0);
  // Only http(s) links are clickable; javascript: never becomes a link.
  const hrefs = await hana
    .locator('[data-testid="chat-message"] a')
    .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  expect(hrefs).toEqual(["https://example.com/ok", "http://evil.example/"]);
  for (const a of await hana.locator('[data-testid="chat-message"] a').all()) {
    await expect(a).toHaveAttribute("rel", /noopener/);
    await expect(a).toHaveAttribute("target", "_blank");
  }
});

async function axe(page: Page, label: string) {
  // Reduced motion: otherwise dialogs are measured mid fade-in (false contrast failures).
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(150);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  if (serious.length) {
    console.log(
      `[a11y] ${label}:\n` +
        serious
          .map(
            (v) =>
              `  ${v.impact} ${v.id}: ${v.help}\n    ${v.nodes
                .slice(0, 3)
                .map((n) => n.target.join(" "))
                .join("\n    ")}`,
          )
          .join("\n"),
    );
  }
  return serious.map((v) => `${label}: ${v.id}`);
}

test("accessibility: no serious or critical WCAG 2.1 AA violations on the main screens", async ({ browser, page }) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  await page.goto("/");
  problems.push(...(await axe(page, "landing")));
  await page.goto("/sign-in");
  problems.push(...(await axe(page, "sign-in")));
  await page.goto("/sign-up");
  problems.push(...(await axe(page, "sign-up")));

  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(hana, gabe, "A11y test");
  await hana.goto("/home");
  await expect(hana.getByTestId("room-card")).toHaveCount(1);
  problems.push(...(await axe(hana, "home")));
  await hana.goto("/settings");
  problems.push(...(await axe(hana, "settings")));
  await hana.goto(roomUrl);
  await expect(hana.getByRole("button", { name: "Join call" })).toBeVisible();
  problems.push(...(await axe(hana, "pre-call")));
  await hana.getByTestId("chat-launcher").click();
  await hana.getByTestId("composer").fill("hello");
  await hana.getByTestId("composer").press("Enter");
  problems.push(...(await axe(hana, "chat")));
  await hana.getByTestId("chat-minimize").click();
  await hana.getByTestId("open-studio").click();
  problems.push(...(await axe(hana, "studio")));
  await hana.keyboard.press("Escape");
  await hana.getByRole("button", { name: "Join call" }).click();
  await expect(hana.getByTestId("meeting-room")).toBeVisible({ timeout: 20_000 });
  problems.push(...(await axe(hana, "call")));

  expect(problems).toEqual([]);
});

test("keyboard: the call can be joined and controlled without a mouse", async ({ browser }) => {
  test.setTimeout(120_000);
  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(hana, gabe, "Keyboard test");
  await hana.goto(roomUrl);
  const join = hana.getByRole("button", { name: "Join call" });
  await expect(join).toBeVisible();
  // Tab until Join is focused (proves it's reachable), then Enter.
  for (let i = 0; i < 40 && !(await join.evaluate((el) => el === document.activeElement)); i++) await hana.keyboard.press("Tab");
  await expect(join).toBeFocused();
  await hana.keyboard.press("Enter");
  await expect(hana.getByTestId("meeting-room")).toBeVisible({ timeout: 20_000 });
  await hana.keyboard.press("ControlOrMeta+d");
  await expect(hana.getByRole("button", { name: "Unmute" })).toBeVisible();
  // Focus is visible on controls (outline drawn).
  await hana.getByRole("button", { name: "Unmute" }).focus();
  const outline = await hana.getByRole("button", { name: "Unmute" }).evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
});
