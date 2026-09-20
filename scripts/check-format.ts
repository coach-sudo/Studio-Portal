import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const supported = /\.(?:css|html|js|json|jsx|md|mjs|ts|tsx|ya?ml)$/i;
const alwaysCheck = [
  ".github/workflows/ci.yml",
  ".prettierrc.json",
  "docs/release-safety.md",
  "docs/verification-baseline-2026-09-19.md",
  "eslint.config.js",
  "netlify/functions/_shared/release.ts",
  "netlify/functions/healthz.ts",
  "playwright.config.ts",
  "scripts/check-bundle-size.ts",
  "scripts/check-format.ts",
  "scripts/check-secrets.ts",
  "scripts/generate-database-types.ts",
];

function gitFiles(args: string[]) {
  try {
    return execFileSync("git", args, { encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

const added = [
  ...gitFiles(["diff", "--name-only", "--diff-filter=A", "origin/main...HEAD"]),
  ...gitFiles(["ls-files", "--others", "--exclude-standard"]),
];
const files = [...new Set([...alwaysCheck, ...added])].filter(
  (file) => supported.test(file) && existsSync(file),
);

if (!files.length) {
  console.log("No new formatted files to check.");
  process.exit(0);
}

const prettier = join(
  process.cwd(),
  "node_modules",
  "prettier",
  "bin",
  "prettier.cjs",
);
const result = spawnSync(process.execPath, [prettier, "--check", ...files], {
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
