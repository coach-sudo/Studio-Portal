import { defineConfig } from "@playwright/test";
import { privatePath } from "./scripts/staging/protected-browser.mjs";
const output = privatePath(process.env.HOSTED_ACCEPTANCE_DIRECTORY || "");
export default defineConfig({
  testDir: "./e2e/focus-local",
  outputDir: `${output}/local-focus-artifacts`,
  reporter: [
    ["list"],
    ["json", { outputFile: `${output}/local-focus-results.json` }],
  ],
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4186",
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4186 --strictPort",
    url: "http://127.0.0.1:4186",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_ANON_KEY: "",
      VITE_ENABLE_DEMO_MODE: "true",
      VITE_QUERY_LAYER_V2: "true",
    },
  },
});
