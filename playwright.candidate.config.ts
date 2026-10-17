import { defineConfig } from "@playwright/test";
import { privatePath } from "./scripts/staging/protected-browser.mjs";

const mode = process.env.CANDIDATE_QUERY_MODE;
if (mode !== "true" && mode !== "false")
  throw Error("Set CANDIDATE_QUERY_MODE explicitly to true or false");
const output = privatePath(process.env.HOSTED_ACCEPTANCE_DIRECTORY || "");
export default defineConfig({
  testDir: "./e2e/candidate-local",
  outputDir: `${output}/candidate-${mode}`,
  reporter: [
    ["list"],
    ["json", { outputFile: `${output}/candidate-${mode}.json` }],
  ],
  workers: 1,
  retries: 0,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4187",
    serviceWorkers: "block",
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "desktop",
      use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "tablet",
      use: { browserName: "chromium", viewport: { width: 768, height: 1024 } },
    },
    {
      name: "mobile",
      use: { browserName: "chromium", viewport: { width: 390, height: 844 } },
    },
    {
      name: "narrow",
      use: { browserName: "chromium", viewport: { width: 320, height: 740 } },
    },
    {
      name: "webkit",
      use: { browserName: "webkit", viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4187 --strictPort",
    url: "http://127.0.0.1:4187",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:54399",
      VITE_SUPABASE_ANON_KEY: "local-browser-contract-key",
      VITE_ENABLE_DEMO_MODE: "false",
      VITE_QUERY_LAYER_V2: mode,
    },
  },
});
