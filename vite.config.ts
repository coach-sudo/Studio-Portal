import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 4173 },
  build: {
    target: "es2022",
    sourcemap: mode !== "production",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "pdf-renderer",
              test: /node_modules[\\/]pdfjs-dist/,
            },
            {
              name: "invoice-font-metrics",
              test: /node_modules[\\/]@pdf-lib[\\/]standard-fonts/,
            },
          ],
        },
      },
    },
  },
}));
