// A separate disposable lifecycle AFTER the original cleanup proof. No hosted mode.
import assert from "node:assert/strict";
import process from "node:process";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { assertIdentityConnectedTarget } from "./identity-connected/guards.mjs";
assertIdentityConnectedTarget(process.env, process.cwd());
assert.equal(process.argv.length, 2, "No target overrides are accepted");
const cleanupProof = readFileSync(
  "test-results/cleanup-verification.txt",
  "utf8",
);
for (const dataset of [
  "public",
  "lesson-ops",
  "storage",
  "auth-users",
  "auth-identities",
])
  assert.ok(
    cleanupProof.includes(`${dataset}: restored to the pre-fixture baseline`),
    "Original fixture cleanup must pass before another lifecycle",
  );
assert.ok(cleanupProof.includes("remaining e2e auth users: 0"));
const config = readFileSync("supabase/config.toml", "utf8");
assert.match(config, /project_id = "studio-portal"/);
assert.match(config, /port = 54322/);
function guard() {
  assertIdentityConnectedTarget(process.env, process.cwd());
  const names = execFileSync(
    "docker",
    [
      "ps",
      "--filter",
      "name=supabase_db_studio-portal",
      "--format",
      "{{.Names}}",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split(/\s+/);
  assert.deepEqual(names, ["supabase_db_studio-portal"]);
}
const sql = (input) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_studio-portal",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input, encoding: "utf8" },
  ).trim();
guard();
assert.match(sql("select version()"), /PostgreSQL 17\./);
const reset = () => {
  guard();
  execFileSync("npx", ["supabase", "db", "reset", "--local", "--no-seed"], {
    stdio: "inherit",
  });
};
mkdirSync("test-results/identity-connected", { recursive: true });
let exitCode = 1,
  started = false;
try {
  // Original fixture cleanup already passed. Start a new owned database lifecycle.
  reset();
  started = true;
  // Same local-fixture-only grant as the standard ephemeral suite; no hosted ACL changes.
  sql(
    "grant usage on schema public to service_role;grant all privileges on all tables in schema public to service_role;grant all privileges on all sequences in schema public to service_role;",
  );
  assert.equal(
    sql("select count(*) from workspace_internal.student_identity_groups"),
    "0",
  );
  const run = spawnSync(
    process.execPath,
    [
      "node_modules/playwright/cli.js",
      "test",
      "--config",
      "e2e/identity-connected/playwright.config.ts",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        E2E_RUN_ID:
          (process.env.E2E_RUN_ID || "e2e-connected").slice(0, 40) +
          "-identity",
      },
    },
  );
  if (run.error) throw run.error;
  exitCode = run.status ?? 1;
} finally {
  if (started) {
    // Never delete retained group/revision/audit rows to satisfy generic fixture cleanup.
    // Discard the entire CI-owned disposable database only after preserving test evidence.
    reset();
    const proof = {
      syntheticAuthUsers: Number(
        sql(
          "select count(*) from auth.users where email like 'e2e-%@example.test'",
        ),
      ),
      identityGroups: Number(
        sql("select count(*) from workspace_internal.student_identity_groups"),
      ),
      identityMembers: Number(
        sql("select count(*) from workspace_internal.student_identity_members"),
      ),
      identityReceipts: Number(
        sql(
          "select count(*) from workspace_internal.student_identity_receipts",
        ),
      ),
      identityRevisions: Number(
        sql(
          "select count(*) from workspace_internal.student_identity_revisions",
        ),
      ),
      duplicateStudents: Number(
        sql(
          "select count(*) from public.students where id='e8620000-0000-4000-8000-000000000021'",
        ),
      ),
      historicalDecisions: Number(
        sql("select count(*) from discovery_internal.source_decisions"),
      ),
      historicalReceipts: Number(
        sql("select count(*) from discovery_internal.review_receipts"),
      ),
      historicalRevisions: Number(
        sql("select count(*) from discovery_internal.decision_revisions"),
      ),
      discardedWholeDisposableDatabase: true,
      hostedActions: [],
    };
    writeFileSync(
      "test-results/identity-connected/disposal-proof.json",
      JSON.stringify(proof, null, 2) + "\n",
    );
    for (const [key, value] of Object.entries(proof))
      if (typeof value === "number") assert.equal(value, 0, key);
  }
}
process.exitCode = exitCode;
