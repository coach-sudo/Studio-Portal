import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
const before = process.env.AUDIT_PROVIDER_IDENTITY_BEFORE === "true";
export default defineConfig({
  testDir: ".",
  testMatch: before ? "before.spec.ts" : "review.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 60000,
  outputDir: "../../test-results/audit-provider-identity",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: fileURLToPath(
          new URL(
            before
              ? "../../test-results/audit-provider-identity-before.json"
              : "../../test-results/audit-provider-identity.json",
            import.meta.url,
          ),
        ),
      },
    ],
  ],
  use: { baseURL: "http://127.0.0.1:4187", serviceWorkers: "block" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    command:
      "node node_modules/vite/bin/vite.js " +
      (before ? ".tmp/identity-before " : "") +
      "--host 127.0.0.1 --port 4187 --strictPort",
    url: "http://127.0.0.1:4187",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:54399",
      VITE_SUPABASE_ANON_KEY: "local-browser-contract-key",
      VITE_ENABLE_DEMO_MODE: "false",
      VITE_QUERY_LAYER_V2: "true",
    },
  },
});
