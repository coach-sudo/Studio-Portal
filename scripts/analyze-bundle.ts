import { gzipSync } from "node:zlib";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const assetsDirectory = join(root, "dist", "assets");

async function size(file: string) {
  const contents = await readFile(file);
  return {
    bytes: contents.byteLength,
    gzipBytes: gzipSync(contents).byteLength,
  };
}

async function cssFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) return cssFiles(file);
      return entry.isFile() && file.endsWith(".css") ? [file] : [];
    }),
  );
  return nested.flat();
}

const assets = (
  await Promise.all(
    (await readdir(assetsDirectory))
      .filter((file) => /\.(?:js|css|svg|png|webp|jpg|woff2?)$/.test(file))
      .map(async (file) => ({ file, ...(await size(join(assetsDirectory, file))) })),
  )
).sort((left, right) => right.gzipBytes - left.gzipBytes);
const sourceStylesheets = (
  await Promise.all(
    (await cssFiles(join(root, "src"))).map(async (file) => ({
      file: relative(root, file).replaceAll("\\", "/"),
      ...(await size(file)),
    })),
  )
).sort((left, right) => right.gzipBytes - left.gzipBytes);

const report = {
  generatedAt: new Date().toISOString(),
  entryJavascript: assets.find(
    (asset) => /^index-[^.]+\.js$/.test(asset.file),
  ),
  globalStylesheet: assets.find(
    (asset) => /^index-[^.]+\.css$/.test(asset.file),
  ),
  assets,
  sourceStylesheets,
};
await writeFile(
  join(root, "dist", "bundle-analysis.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
