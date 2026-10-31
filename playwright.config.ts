import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// Same .env.local the app uses, so tests know whether a backend is configured.
loadEnvConfig(process.cwd());

const PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * E2E runs against a production build (so the real CSP applies).
 * Uses the locally installed Google Chrome; CI can switch to bundled Chromium with E2E_CHANNEL=chromium.
 * Fake media flags let two browser contexts "see" each other without cameras.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.E2E_CHANNEL ?? "chrome",
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            // Lets the audio checks run without a click gesture.
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
  ],
  webServer: {
    // E2E_DEV=1 runs against `next dev` (React StrictMode double-mounts), which is how people develop locally.
    command: process.env.E2E_DEV ? `npx next dev -p ${PORT}` : `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
