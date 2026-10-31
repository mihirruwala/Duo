import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/** Service-role client for test setup/teardown only (never used by the app under test). */
export function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Users created during the current test; deleted afterwards (cascades their rooms, messages, files rows). */
export const createdUserIds = new Set<string>();

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
      if (createdUserIds.size) {
        const admin = adminClient();
        await Promise.all([...createdUserIds].map((id) => admin.auth.admin.deleteUser(id).catch(() => undefined)));
        createdUserIds.clear();
      }
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

export const hasBackend = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_SECRET_KEY,
);
