import { ESLint } from "eslint";
import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import process from "node:process";
import console from "node:console";

const eslint = new ESLint(),
  results = await eslint.lintFiles(["."]);
const inventory = {};
let errors = 0,
  warnings = 0;
for (const file of results)
  for (const message of file.messages) {
    const key = `${relative(process.cwd(), file.filePath).replaceAll("\\", "/")}|${message.ruleId || "parse"}|${message.severity}`;
    inventory[key] = (inventory[key] || 0) + 1;
    if (message.severity === 2) errors++;
    else warnings++;
  }
const sorted = Object.fromEntries(
  Object.entries(inventory).sort(([a], [b]) => a.localeCompare(b)),
);
const path = "docs/lint-warning-baseline.json";
if (process.argv.includes("--write")) {
  if (errors) throw new Error("Cannot establish a baseline with lint errors.");
  await writeFile(
    path,
    JSON.stringify(
      {
        description:
          "Non-increasing ESLint inventory by file, rule and severity. Update deliberately after review.",
        warnings,
        inventory: sorted,
      },
      null,
      2,
    ) + "\n",
  );
} else {
  const baseline = JSON.parse(await readFile(path, "utf8"));
  const increases = Object.entries(sorted).filter(
    ([key, count]) => count > (baseline.inventory[key] || 0),
  );
  if (errors || increases.length) {
    console.error(JSON.stringify({ errors, increases }, null, 2));
    process.exitCode = 1;
  }
}
console.log(
  JSON.stringify({
    errors,
    warnings,
    inventoryEntries: Object.keys(sorted).length,
    mode: process.argv.includes("--write") ? "recorded" : "checked",
  }),
);
