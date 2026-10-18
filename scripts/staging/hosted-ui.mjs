// Explicit entrypoint. --prepare is entirely offline; no mode is implicit.
import process from "node:process";
import console from "node:console";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { plan, candidate, manifestHash } from "./ui/policy.mjs";
import { inventory } from "./ui/cases.mjs";
import { executorHash } from "./ui/private.mjs";
export function preparation() {
  return {
    status: "LOCAL_IMPLEMENTATION_REVIEW_REQUIRED_NO_HOSTED_AUTHORIZATION",
    runId: plan.runId,
    candidate,
    manifestHash,
    manifest: plan,
    executorHash: executorHash(),
    target: {
      ...plan.target,
      candidate,
      deployment: null,
      origin: null,
      artifactHash: null,
    },
    inventory,
    budgets: plan.budgets,
    requiredPrivateFiles: [
      "ui-config.json",
      "new exact-host perimeter.json",
      "approved artifact-identity.json",
      "fresh UI01-UI09 authorization.json with baselineHash",
    ],
    gates: [
      "separate one-deploy approval",
      "actual returned new deployment and function digests",
      "separate minimal exact-host Auth update approval",
      "fresh all-deployment team-login proof",
      "read-only original-business/Auth/migration/environment fingerprints",
      "independent executor and cleanup review",
      "fresh separate hosted UI fixture/mutation/cleanup approval",
    ],
    note: "This file is not an authorization receipt. No fabricated deployment ID, expiry or signature.",
  };
}
async function main() {
  const [mode, file] = process.argv.slice(2);
  if (mode === "--prepare") {
    assert(file, "Provide output proposal JSON path");
    writeFileSync(
      resolve(file),
      JSON.stringify(preparation(), null, 2) + "\n",
      { flag: "wx" },
    );
    console.log(
      "Offline UI preparation written; zero network or hosted mutations.",
    );
    return;
  }
  if (mode === "--execute" || mode === "--resume-cleanup") {
    assert(file, "Absolute restricted UI config required");
    const { executeHosted } = await import("./ui/hosted.mjs");
    console.log(
      JSON.stringify(
        await executeHosted(file, { cleanupOnly: mode === "--resume-cleanup" }),
      ),
    );
    return;
  }
  throw Error(
    "Explicit --prepare OUTPUT, --execute PRIVATE_CONFIG or --resume-cleanup PRIVATE_CONFIG required. No automatic authorization or retry.",
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(
      "UI executor stopped:",
      error.code || error.name,
      "Inspect private journal; no automatic retry.",
    );
    process.exitCode = 1;
  });
