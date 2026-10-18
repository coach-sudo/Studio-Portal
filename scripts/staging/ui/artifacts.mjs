// Offline Linux receipt augmentation. No upload, credentials or network.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import process from "node:process";
import { candidate } from "./policy.mjs";
const [checkout, input, output] = process.argv.slice(2);
assert.equal(process.platform, "linux");
assert.equal(process.arch, "x64");
assert.equal(process.versions.node.split(".")[0], "22");
assert.equal(
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: checkout,
    encoding: "utf8",
  }).trim(),
  candidate,
);
assert.equal(
  execFileSync("git", ["status", "--porcelain"], {
    cwd: checkout,
    encoding: "utf8",
  }).trim(),
  "",
);
const identity = JSON.parse(readFileSync(input, "utf8"));
assert.equal(identity.candidate, candidate);
assert.equal(identity.functions.length, 23);
assert.equal(identity.release, "deploy-preview/" + candidate.slice(0, 12));
const root = resolve(checkout, "dist");
const client = readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((x) => x.isFile())
  .map((x) => {
    const file = resolve(x.parentPath, x.name),
      bytes = readFileSync(file);
    return {
      file: relative(root, file).replaceAll("\\", "/"),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  })
  .sort((a, b) => a.file.localeCompare(b.file));
for (const expected of identity.client)
  assert.deepEqual(
    client.find((f) => f.file === expected.file),
    expected,
  );
writeFileSync(
  join(output),
  JSON.stringify(
    { ...identity, client, allStaticFilesIncluded: true },
    null,
    2,
  ) + "\n",
  { flag: "wx", mode: 0o600 },
);
