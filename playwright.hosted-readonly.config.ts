import { defineConfig } from "@playwright/test";
import { hostedAcceptance } from "./src/security/hostedAcceptance";
import { acceptanceDirectory } from "./e2e/support/hostedReadOnly";

export default defineConfig({
  testDir: "./e2e/hosted-readonly",
  outputDir: `${acceptanceDirectory}/artifacts`,
  globalSetup: "./e2e/hosted-readonly/setup.ts",
  retries: 0,
  workers: 1,
  timeout: 60_000,
  reporter: [
    ["list"],
    ["json", { outputFile: `${acceptanceDirectory}/hosted-results.json` }],
  ],
  use: {
    baseURL: hostedAcceptance.origin,
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off",
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "webkit-1440",
      grep: /session identity|@responsive/,
      use: { browserName: "webkit", viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "desktop-1440",
      use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "tablet-768",
      grep: /@responsive/,
      use: { browserName: "chromium", viewport: { width: 768, height: 1024 } },
    },
    {
      name: "mobile-390",
      grep: /@responsive/,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-320",
      grep: /@responsive/,
      use: {
        browserName: "chromium",
        viewport: { width: 320, height: 740 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
