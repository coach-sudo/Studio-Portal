import { defineConfig } from "@playwright/test";

// Local application journeys only: no hosted setup, credentials, or teardown.
export default defineConfig({
  testDir: "./e2e/workspace-local",
  outputDir: "test-results/workspace-artifacts",
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/workspace-results.json" }],
  ],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    {
      name: "legacy-chromium",
      use: { browserName: "chromium", baseURL: "http://127.0.0.1:5179" },
    },
    {
      name: "v2-chromium",
      use: { browserName: "chromium", baseURL: "http://127.0.0.1:5180" },
    },
    {
      name: "v2-webkit",
      use: { browserName: "webkit", baseURL: "http://127.0.0.1:5180" },
    },
  ],
  webServer: [false, true].map((v2, index) => ({
    command: `npx vite --host 127.0.0.1 --port ${5179 + index} --strictPort`,
    url: `http://127.0.0.1:${5179 + index}`,
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_ANON_KEY: "",
      VITE_ENABLE_DEMO_MODE: "true",
      VITE_QUERY_LAYER_V2: String(v2),
    },
  })),
});
