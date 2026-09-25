import { gzipSync } from "node:zlib";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const assetsDirectory = join(process.cwd(), "dist", "assets");
const files = await readdir(assetsDirectory);

async function largestAsset(extension: ".js" | ".css") {
  const candidates = await Promise.all(
    files
      .filter((file) => file.endsWith(extension))
      .map(async (file) => {
        const contents = await readFile(join(assetsDirectory, file));
        return {
          file,
          bytes: contents.byteLength,
          gzipBytes: gzipSync(contents).byteLength,
        };
      }),
  );
  return candidates.sort((left, right) => right.gzipBytes - left.gzipBytes)[0];
}

const [javascript, stylesheet] = await Promise.all([
  largestAsset(".js"),
  largestAsset(".css"),
]);

if (!javascript || !stylesheet) {
  throw new Error("Build assets are missing. Run npm run build first.");
}

if (process.argv.includes("--require-configured-client")) {
  const bundles = await Promise.all(
    files
      .filter((file) => file.endsWith(".js"))
      .map((file) => readFile(join(assetsDirectory, file), "utf8")),
  );
  if (
    !bundles.some((bundle) =>
      bundle.includes("https://ci.example.supabase.co"),
    ) ||
    !bundles.some((bundle) => bundle.includes("sb_publishable_ci_example"))
  ) {
    throw new Error(
      "The bundle was not built with CI's browser-public Supabase placeholders.",
    );
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  javascript,
  stylesheet,
  budgets: {
    javascriptWarningGzipBytes: 120_000,
    javascriptFailureGzipBytes: 130_000,
    stylesheetWarningGzipBytes: 22_000,
    stylesheetFailureGzipBytes: 25_000,
  },
};

console.log(JSON.stringify(report, null, 2));
await writeFile(
  join(process.cwd(), "dist", "bundle-size-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

const warnings: string[] = [];
if (javascript.gzipBytes > report.budgets.javascriptWarningGzipBytes)
  warnings.push(
    `JavaScript ${javascript.file} exceeds the 120 KB gzip warning.`,
  );
if (stylesheet.gzipBytes > report.budgets.stylesheetWarningGzipBytes)
  warnings.push(
    `Stylesheet ${stylesheet.file} exceeds the 22 KB gzip warning.`,
  );
for (const warning of warnings) console.warn(`[bundle-warning] ${warning}`);

if (
  javascript.gzipBytes > report.budgets.javascriptFailureGzipBytes ||
  stylesheet.gzipBytes > report.budgets.stylesheetFailureGzipBytes
) {
  process.exitCode = 1;
}
