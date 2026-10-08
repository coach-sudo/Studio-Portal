import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
    environment: "jsdom",
    maxWorkers: 2,
    setupFiles: ["./src/test/setup.ts"],
    coverage: { reporter: ["text", "json-summary"] },
  },
});
