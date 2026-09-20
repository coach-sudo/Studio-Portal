import { defineConfig, devices } from "@playwright/test";
import { assertNonProductionE2EUrl } from "./src/security/e2eSafety";

const baseURL = process.env.STAGING_BASE_URL;

if (!baseURL) {
  throw new Error("STAGING_BASE_URL is required for deployed browser checks.");
}

assertNonProductionE2EUrl(baseURL);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/artifacts",
  globalSetup: "./e2e/global.setup.ts",
  globalTeardown: "./e2e/global.teardown.ts",
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never" }],
        ["json", { outputFile: "test-results/results.json" }],
      ]
    : [["list"], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      grepInvert: /@mobile-only/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      grep: /@mobile|@smoke/,
      use: { ...devices["Pixel 7"] },
    },
  ],
});
