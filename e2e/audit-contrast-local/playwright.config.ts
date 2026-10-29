import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: ".",
  testMatch: "contrast.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60000,
  outputDir: "../../test-results/audit-contrast",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: fileURLToPath(
          new URL("../../test-results/audit-contrast.json", import.meta.url),
        ),
      },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:4191",
    serviceWorkers: "block",
    reducedMotion: "reduce",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    command:
      "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4191 --strictPort",
    url: "http://127.0.0.1:4191",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_ANON_KEY: "",
      VITE_ENABLE_DEMO_MODE: "true",
      VITE_QUERY_LAYER_V2: "true",
    },
  },
});
