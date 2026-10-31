import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";

/** Contexts opened by helpers during the current test; closed automatically afterwards. */
export const openContexts = new Set<BrowserContext>();

/**
 * Every test page fails on CSP violations, uncaught errors, or console errors,
 * so a broken policy or a runtime crash can't hide behind a passing assertion.
 */
export const test = base.extend<{ watchPage: (page: Page) => () => string[]; _closeUsers: void }>({
  // Auto fixture: every test starts clean. Leftover pages (some still in a live call) would
  // otherwise pile up across tests in the same worker and starve later ones of CPU.
  _closeUsers: [
    async ({}, provide) => {
      await provide();
      await Promise.all([...openContexts].map((c) => c.close().catch(() => undefined)));
      openContexts.clear();
    },
    { auto: true },
  ],
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
