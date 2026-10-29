// Runs only against the named disposable local stack. No URL/credential input.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
assert.equal(process.env.CURRENT_PRODUCTION_ACCEPTANCE_LOCAL, "true");
assert.ok(
  process.argv.length === 2 ||
    (process.argv.length === 3 && process.argv[2] === "--verify-files-only"),
  "Remote targets and extra arguments are forbidden",
);
const manifest = JSON.parse(
  readFileSync("docs/current-production-migrations.json", "utf8"),
);
assert.equal(manifest.commit, "fb2fcb63f7ac6f06dc8ee9d954e519bdde5773cb");
const versions = manifest.migrations.map((m) => m.version);
assert.equal(versions.length, 71);
assert.equal(versions.at(-1), "20261026161014");
const files = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
assert.deepEqual(
  files.slice(0, versions.length),
  manifest.migrations.map((m) => m.file),
  "All71 filenames must match the audited Git prefix",
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const item of manifest.migrations) {
  assert.equal(item.file, `${item.version}_${item.name}.sql`);
  const path = `supabase/migrations/${item.file}`;
  assert.equal(
    digest(execFileSync("git", ["show", `${manifest.commit}:${path}`])),
    item.sha256,
    `${path}: manifest must match the exact audited Git blob`,
  );
  assert.equal(
    digest(readFileSync(path, "utf8").replaceAll("\r\n", "\n")),
    item.sha256,
    `${path}: candidate must preserve historical bytes`,
  );
}
if (process.argv[2] === "--verify-files-only") {
  console.log(
    "All71 audited Git filenames and SHA256 checksums verified; no database operation executed. Hosted SQL contents are not asserted.",
  );
  process.exit(0);
}
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
const query = (sql) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      names[0],
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-qAt",
    ],
    { input: sql, encoding: "utf8" },
  ).trim();
const cli = (...args) =>
  execFileSync("npx", ["supabase", ...args], { stdio: "inherit" });
assert.match(query("select version()"), /PostgreSQL 17\./);
assert.deepEqual(
  files.slice(0, versions.length).map((f) => f.split("_")[0]),
  versions,
  "Current hosted migration history must exactly match the local prefix",
);
cli("db", "reset", "--local", "--no-seed", "--version", versions.at(-1));
const history = () =>
  JSON.parse(
    query(
      "select json_agg(version order by version) from supabase_migrations.schema_migrations",
    ),
  );
assert.deepEqual(history(), versions);
query(readFileSync("scripts/fixtures/wave-one-upgrade.sql", "utf8"));
query(readFileSync("scripts/fixtures/current-production-upgrade.sql", "utf8"));
const tables = JSON.parse(
  query(
    "select json_agg(format('%I.%I',n.nspname,c.relname) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','credit_internal','lesson_ops','workspace_internal','worker_internal','library_internal','discovery_internal')",
  ),
);
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const columns = (table) =>
  JSON.parse(
    query(
      `select json_agg(json_build_object('name',attname,'type',format_type(atttypid,atttypmod),'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=${quote(table)}::regclass and a.attnum>0 and not a.attisdropped`,
    ),
  );
const baselineColumns = new Map(tables.map((table) => [table, columns(table)]));
// Compare all original columns/rows, including owner IDs, outcomes, timestamps,
// derived jobs, provider links, immutable receipts, authored work and accounting.
const snapshot = () =>
  JSON.stringify(
    tables.map((table) => [
      table,
      JSON.parse(
        query(
          `select coalesce(jsonb_agg(original order by original::text),'[]'::jsonb) from (select (select jsonb_object_agg(k,to_jsonb(t)->k) from unnest(array[${baselineColumns
            .get(table)
            .map((c) => quote(c.name))
            .join(",")}]) k) as original from ${table} t) original_rows`,
        ),
      ),
    ]),
  );
const before = snapshot();
cli("migration", "up", "--local");
const addedColumns = [];
for (const table of tables) {
  const original = baselineColumns.get(table),
    after = columns(table);
  const names = new Set(original.map((c) => c.name));
  assert.deepEqual(
    after
      .filter((c) => names.has(c.name))
      .map(({ name, type }) => ({ name, type })),
    original.map(({ name, type }) => ({ name, type })),
    `${table}: original column names and types must survive`,
  );
  for (const column of after.filter((c) => !names.has(c.name)))
    addedColumns.push({ table, ...column });
}
assert.deepEqual(
  addedColumns,
  manifest.expectedAddedOriginalTableColumns,
  "New original-table columns/defaults require an explicit reviewed upgrade expectation",
);
assert.deepEqual(
  history(),
  files.map((f) => f.split("_")[0]),
);
assert.equal(
  snapshot(),
  before,
  "Current-prefix upgrade must preserve every original tracked row byte-for-byte",
);
const candidateOnly = JSON.parse(
  query(
    "select coalesce(json_agg(format('%I.%I',n.nspname,c.relname)),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='discovery_internal' or (n.nspname='workspace_internal' and c.relname like 'student_identity_%'))",
  ),
);
for (const table of candidateOnly)
  if (!tables.includes(table))
    assert.equal(
      query(`select count(*) from ${table}`),
      "0",
      `${table} must not invent historical discovery or identity data`,
    );
if (
  query(
    "select to_regclass('workspace_internal.student_identity_groups') is not null",
  ) === "t"
) {
  query(
    "begin;set local role authenticated;select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);do $$begin begin perform public.merge_studio_students('e3000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000002');raise exception 'EXPECTED_IDENTITY_REVIEW_HOLD';exception when others then if sqlstate<>'P0001' or sqlerrm not like 'REVIEW_REQUIRED%' then raise;end if;end;end$$;rollback;",
  );
  assert.equal(
    snapshot(),
    before,
    "Identity review hold must preserve original history",
  );
}
console.log(
  `Current production-prefix upgrade passed: ${versions.length} baseline + ${files.length - versions.length} additive migrations; ${tables.length} original table families byte-equivalent.`,
);
// The next CI step resets this entire disposable DB before pgTAP/concurrency.
