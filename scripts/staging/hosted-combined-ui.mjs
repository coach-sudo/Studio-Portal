// Explicit new authorized run only; the historical exhausted lane is immutable.
import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { executeHosted } from "./combined-ui/hosted.mjs";
const [mode, config, flag] = process.argv.slice(2);
assert.equal(
  mode,
  "--execute",
  "An explicit new-run execution instruction is required",
);
assert(config && [undefined, "--cleanup-only"].includes(flag));
executeHosted(config, { cleanupOnly: flag === "--cleanup-only" })
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error(
      "Focused run stopped; inspect private journal before any retry:",
      e.code || e.name,
      e.message,
    );
    process.exitCode = 1;
  });
