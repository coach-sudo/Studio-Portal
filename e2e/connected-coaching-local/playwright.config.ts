import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "coaching.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4176", browserName: "chromium" },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4176",
    url: "http://127.0.0.1:4176",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_ANON_KEY: "",
      VITE_ENABLE_DEMO_MODE: "true",
      VITE_QUERY_LAYER_V2: "true",
    },
  },
});
