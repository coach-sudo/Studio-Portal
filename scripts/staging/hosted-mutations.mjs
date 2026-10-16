import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL, URL } from "node:url";
import process from "node:process";
import console from "node:console";
import {
  target,
  ids,
  manifestHash,
  sha,
  businessRowsMaximum,
  recordLimits,
} from "./mutations/policy.mjs";
import { Journal } from "./mutations/journal.mjs";
import { Executor } from "./mutations/engine.mjs";
import { seed, cleanup } from "./mutations/fixtures.mjs";
import { runCases } from "./mutations/cases.mjs";
import { createHosted, privateDirectory } from "./mutations/hosted.mjs";
import { plan } from "./prepare-hosted-mutation-plan.mjs";

export function codeHash() {
  return sha(
    [
      "hosted-mutations.mjs",
      "prepare-hosted-mutation-plan.mjs",
      "protected-browser.mjs",
      "schema-fingerprint.sql",
      "../../docs/wave-one-hosted-business-verification.json",
      "mutations/schema-seal.json",
      ...[
        "policy",
        "journal",
        "engine",
        "fixtures",
        "cases",
        "hosted",
        "seal",
      ].map((n) => "mutations/" + n + ".mjs"),
    ]
      .map((n) =>
        readFileSync(new URL(n, import.meta.url), "utf8").replaceAll(
          "\r\n",
          "\n",
        ),
      )
      .join("\n"),
  );
}
async function main() {
  const [mode, directory, approval, ...extra] = process.argv.slice(2);
  if (extra.length) throw Error("Unexpected arguments");
  if (!mode || mode === "--describe") {
    console.log(
      JSON.stringify(
        {
          status: "NOT_AUTHORIZED",
          target,
          manifestHash,
          codeHash: codeHash(),
          limits: { ...plan.limits, businessRowsMaximum, recordLimits },
          ids,
          cases: plan.cases,
          backendOnly: [
            "H06 bypasses the provider-capable HTTP wrapper; exercises canonical SQL only",
            "H16 uses bounded candidate/review/progress reads, not a browser result-route journey",
          ],
          retained: [
            "all audit, replay and deletion evidence",
            "two disabled terminal students and zero-auto credit accounts",
            "banned coach Auth identity with no memberships",
          ],
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!["--execute", "--cleanup", "--resume"].includes(mode))
    throw Error("Unknown mode");
  privateDirectory(directory);
  const previous = existsSync(join(directory, "mutation-journal.jsonl"));
  assertMode(mode, previous);
  // This receipt must be created only after the human approves this exact scope.
  const host = await createHosted(directory, codeHash(), approval);
  let journal;
  try {
    journal = new Journal(directory, codeHash());
    host.bindJournal(journal);
    const e = new Executor({ ...host, journal });
    await e.initialize();
    if (journal.find("finished", "H01-H16")) {
      console.log("Already completed; no operation repeated.");
      return;
    }
    if (mode !== "--cleanup") {
      await seed(e);
      await runCases(e);
    }
    const retained = await cleanup(e);
    journal.append({ type: "finished", name: "H01-H16", retained });
    console.log(
      "Scoped run and cleanup verified. Read the restricted journal and retained-artifact report.",
    );
  } finally {
    journal?.close();
    await host.close();
  }
}
export function assertMode(mode, previous) {
  if (mode === "--execute" && previous)
    throw Error("Existing run requires explicit resume or cleanup");
  if (mode !== "--execute" && !previous)
    throw Error("No existing run to recover");
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main().catch(() => {
    console.error(
      "Executor stopped. No automatic retry; inspect the restricted journal. Sensitive diagnostics suppressed.",
    );
    process.exitCode = 1;
  });
