import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "operations.spec.ts",
  workers: 1,
  retries: 0,
  outputDir: "../../test-results/wave-five-local-artifacts",
  timeout: 90000,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/wave-five-browser.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4178",
    browserName: "chromium",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4178",
    url: "http://127.0.0.1:4178",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_ANON_KEY: "",
      VITE_ENABLE_DEMO_MODE: "true",
      VITE_QUERY_LAYER_V2: "true",
    },
  },
});
