import { access, readFile, realpath, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { patchNetlifyDevApiResponses } from "./netlify-dev-api-patch";

let cliRoot = process.argv[2];
if (!cliRoot) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    try {
      const executable = join(directory, "netlify");
      await access(executable);
      cliRoot = dirname(dirname(await realpath(executable)));
      break;
    } catch {
      // PATH entries need not contain the requested executable.
    }
  }
}
if (!cliRoot)
  throw new Error(
    "Netlify CLI executable is unavailable in this isolated runtime.",
  );
const manifest = JSON.parse(
  await readFile(join(cliRoot, "package.json"), "utf8"),
);
if (manifest.name !== "netlify-cli" || manifest.version !== "27.8.0")
  throw new Error("The API response guard supports only Netlify CLI 27.8.0.");
const filename = join(cliRoot, "dist", "utils", "proxy.js");
const original = await readFile(filename, "utf8");
await writeFile(filename, patchNetlifyDevApiResponses(original));
console.log(
  "Isolated Netlify CLI API responses retain original authorization status; static fallbacks unchanged.",
);
