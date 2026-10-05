import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
// Never upload the raw Function log: it can contain request/provider details.
// Only static exception categories, SQLSTATE and database column identifiers are retained.
const source = await readFile(
  path.join(process.env.RUNNER_TEMP!, "netlify-serve.log"),
  "utf8",
);
const evidence = {
  databaseCodes: [...source.matchAll(/code:\s*['"]([A-Z0-9_]{5,40})['"]/g)].map(
    (match) => match[1],
  ),
  nullColumns: [...source.matchAll(/null value in column "([a-z_]+)"/g)].map(
    (match) => match[1],
  ),
  missingColumns: [
    ...source.matchAll(/column [a-z_.]+\.([a-z_]+) does not exist/g),
  ].map((match) => match[1]),
  invalidTime: source.includes("Invalid time value"),
  undefinedIdentifiers: [
    ...source.matchAll(
      /ReferenceError: ([A-Za-z_][A-Za-z0-9_]*) is not defined/g,
    ),
  ].map((match) => match[1]),
};
await writeFile(
  "test-results/function-diagnostics.json",
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence));
