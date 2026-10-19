// Destructive reset is confined to the disposable local Docker stack. No URL input.
import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
assert.equal(process.env.WAVE_ONE_ACCEPTANCE_LOCAL, "true");
assert.equal(
  process.argv.length,
  2,
  "Remote targets and extra arguments are forbidden",
);
const containers = execFileSync(
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
assert.equal(containers.length, 1);
assert.match(containers[0], /^supabase_db_studio-portal$/);
const query = (sql) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      containers[0],
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-qAt",
    ],
    { input: sql, encoding: "utf8" },
  ).trim();
const cli = (...args) =>
  execFileSync("npx", ["supabase", ...args], { stdio: "inherit" });
const manifest = JSON.parse(
  readFileSync("docs/wave-one-production-migrations.json", "utf8"),
);
const versions = manifest.migrations.map((m) => m.version);
const files = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
assert.deepEqual(
  files.slice(0, versions.length).map((f) => f.split("_")[0]),
  versions,
  "Production history must exactly match the local prefix",
);
cli("db", "reset", "--local", "--no-seed", "--version", versions.at(-1));
assert.deepEqual(
  JSON.parse(
    query(
      "select json_agg(version order by version) from supabase_migrations.schema_migrations",
    ),
  ),
  versions,
);
query(readFileSync("scripts/fixtures/wave-one-upgrade.sql", "utf8"));
const snapshot = () =>
  query(`select jsonb_build_object(
 'ledger',(select jsonb_agg(to_jsonb(x) order by id) from public.package_credit_entries x),
 'packages',(select jsonb_agg(to_jsonb(x) order by id) from public.packages x),
 'lessons',(select jsonb_agg(to_jsonb(x) order by id) from public.lessons x),
 'invoices',(select jsonb_agg(to_jsonb(x) order by id) from public.studio_invoices x),
 'payments',(select jsonb_agg(to_jsonb(x) order by id) from public.payment_entries x),
 'notes',(select jsonb_agg(to_jsonb(x) order by id) from public.notes x),
 'accounts',(select jsonb_agg(to_jsonb(x) order by student_id) from public.student_credit_accounts x))`);
const before = snapshot();
cli("migration", "up", "--local");
assert.equal(
  snapshot(),
  before,
  "Upgrade must not rewrite balances, holds, notes, payment or invoice history",
);
assert.deepEqual(
  JSON.parse(
    query(
      "select json_agg(version order by version) from supabase_migrations.schema_migrations",
    ),
  ),
  files.map((f) => f.split("_")[0]),
);
query(
  "set role authenticated;select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',false);select public.student_credit_coverage('e3000000-0000-4000-8000-000000000001');select public.student_financial_overview('e3000000-0000-4000-8000-000000000001');",
);
assert.equal(
  snapshot(),
  before,
  "Diagnostic reads must leave baseline history unchanged",
);
console.log(
  `Production-prefix upgrade passed: ${versions.length} baseline + ${files.length - versions.length} Wave 1 migrations; financial/coaching history byte-equivalent.`,
);
// The following CI step resets the entire disposable DB before pgTAP/concurrency.
