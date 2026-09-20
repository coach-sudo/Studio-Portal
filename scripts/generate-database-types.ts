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
const generated = result.stdout;

if (!generated.includes("export type Database")) {
  throw new Error("Supabase did not return a Database type definition.");
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, generated.replace(/\r\n/g, "\n"), "utf8");
console.log(`Generated ${output} from ${mode.slice(2)} schema.`);
