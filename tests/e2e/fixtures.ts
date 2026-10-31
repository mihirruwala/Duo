import { test as base, expect, type Page } from "@playwright/test";

/**
 * Every test page fails on CSP violations, uncaught errors, or console errors,
 * so a broken policy or a runtime crash can't hide behind a passing assertion.
 */
export const test = base.extend<{ watchPage: (page: Page) => () => string[] }>({
  watchPage: async ({}, provide) => {
    await provide((page: Page) => {
      const problems: string[] = [];
      page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
      });
      return () => problems;
    });
  },
});

export { expect };

export const hasBackend = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
