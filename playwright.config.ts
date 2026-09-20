import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.STAGING_BASE_URL;

if (!baseURL) {
  throw new Error("STAGING_BASE_URL is required for deployed browser checks.");
}

const hostname = new URL(baseURL).hostname.toLowerCase();
if (hostname === "portal.d-a-j.com" || hostname.endsWith(".portal.d-a-j.com")) {
  throw new Error("Deployed browser checks must never target production.");
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/artifacts",
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-last-retry",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
