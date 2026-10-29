import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { assertIdentityConnectedTarget } from "../../scripts/identity-connected/guards.mjs";
assertIdentityConnectedTarget(process.env, process.cwd());
export default defineConfig({
  testDir: ".",
  testMatch: ["identity.spec.ts", "historical.spec.ts"],
  workers: 1,
  retries: 0,
  timeout: 120000,
  globalSetup: "../global.setup.ts",
  // Retained private group history intentionally survives until the wrapper discards the whole local DB.
  globalTeardown: undefined,
  outputDir: "../../test-results/identity-connected/artifacts",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: fileURLToPath(
          new URL(
            "../../test-results/identity-connected/results.json",
            import.meta.url,
          ),
        ),
      },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:8888",
    browserName: "chromium",
    serviceWorkers: "block",
    bypassCSP: true,
    viewport: { width: 1440, height: 1000 },
  },
});
