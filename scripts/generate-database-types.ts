import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const mode = process.argv.includes("--linked") ? "--linked" : "--local";
const output = join(process.cwd(), "src", "types", "database.generated.ts");
const cli = join(
  process.cwd(),
  "node_modules",
  "supabase",
  "dist",
  "supabase.js",
);
const result = spawnSync(
  process.execPath,
  [cli, "gen", "types", "typescript", mode, "--schema", "public"],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  },
);
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(
    `Supabase type generation exited with status ${result.status}.`,
  );
const generated = result.stdout.replace(/\r\n/g, "\n");

if (!generated.includes("export type Database")) {
  throw new Error("Supabase did not return a Database type definition.");
}

mkdirSync(dirname(output), { recursive: true });
const lines = generated.split("\n");
const metadataStart = lines.findIndex(
  (line) => line.trim() === "__InternalSupabase: {",
);

if (metadataStart >= 0) {
  let blockStart = metadataStart;
  while (blockStart > 0 && lines[blockStart - 1]?.trim().startsWith("//")) {
    blockStart -= 1;
  }

  let depth = 0;
  let blockEnd = metadataStart;
  for (; blockEnd < lines.length; blockEnd += 1) {
    const line = lines[blockEnd] ?? "";
    depth += (line.match(/{/g) ?? []).length;
    depth -= (line.match(/}/g) ?? []).length;
    if (blockEnd > metadataStart && depth === 0) {
      blockEnd += 1;
      break;
    }
  }

  lines.splice(blockStart, blockEnd - blockStart);
}

const normalized = `${lines.join("\n").trimEnd()}\n`;
writeFileSync(output, normalized, "utf8");
console.log(`Generated ${output} from ${mode.slice(2)} schema.`);
