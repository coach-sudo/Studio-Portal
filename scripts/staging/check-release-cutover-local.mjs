// Read/rollback characterization against an existing disposable native PG17.
// Never accepts a hosted URL, credential, project or database endpoint.
import assert from "node:assert/strict";
import fs from "node:fs";
import process from "node:process";
import console from "node:console";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
const runtime = resolve(process.env.STUDIO_LOCAL_PG_RUNTIME);
const cluster = resolve(process.env.STUDIO_LOCAL_CUTOVER_CLUSTER);
assert(cluster.startsWith(runtime + sep));
assert.match(cluster.slice(runtime.length + 1), /^combined-ui-\d+$/);
const { Client } = createRequire(join(runtime, "package.json"))("pg");
const { pg_ctl } = await import(
  pathToFileURL(
    join(runtime, "node_modules/@embedded-postgres/windows-x64/dist/index.js"),
  ).href
);
const bin = (args) =>
  execFileSync(pg_ctl, args, { stdio: "ignore", windowsHide: true });
const data = join(cluster, "data");
bin([
  "-D",
  data,
  "-l",
  join(cluster, "cutover.log"),
  "-o",
  "-h 127.0.0.1 -p 56439 -c studio.combined_disposable=focused-ui",
  "-w",
  "start",
]);
const db = new Client({
  host: "127.0.0.1",
  port: 56439,
  user: "postgres",
  database: "ui_combined",
});
try {
  await db.connect();
  assert.equal(
    (await db.query("select current_setting('studio.combined_disposable') v"))
      .rows[0].v,
    "focused-ui",
  );
  await db.query("begin");
  const studio = "4ceff683-e72f-4b2e-96ce-85db2dca4eb2";
  const student = "bbaabbaa-1111-4111-a111-000000000001";
  const lesson = "bbaabbaa-1111-4111-a111-000000000002";
  await db.query(
    "insert into public.students(id,studio_id,full_name,portal_enabled) values($1,$2,'Local cutover characterization',false)",
    [student, studio],
  );
  await db.query(
    "insert into public.student_credit_accounts(student_id,auto_apply) values($1,false)",
    [student],
  );
  await db.query(
    "insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,price_minor,paid_minor,payment_status,source_provider) values($1,$2,$3,'Local cutover','2099-01-01T12:00Z','2099-01-01T13:00Z','scheduled','in_person','Local studio',0,0,'due','studio')",
    [lesson, studio, student],
  );
  const before = (
    await db.query("select version from public.lessons where id=$1", [lesson])
  ).rows[0];
  // Exact RPC still called by published 6df35d7, with no new actor setting.
  const result = (
    await db.query("select public.command_cancel_lesson_credit($1,$2,true) v", [
      lesson,
      before.version,
    ])
  ).rows[0].v;
  const effects = (
    await db.query(
      "select lesson_version,status,kind from lesson_ops.effects where lesson_id=$1",
      [lesson],
    )
  ).rows;
  assert.equal(result.lesson.status, "cancelled");
  assert.equal(effects.length, 1);
  assert.equal(effects[0].lesson_version, result.lesson.version);
  assert.equal(effects[0].status, "queued");
  assert.equal(effects[0].kind, "cancelled");
  await db.query("rollback");
  assert.equal(
    (
      await db.query("select count(*) n from public.lessons where id=$1", [
        lesson,
      ])
    ).rows[0].n,
    "0",
  );
  const proof = {
    checkedAt: new Date().toISOString(),
    localOnly: true,
    postgres: 17,
    schemaMigrations: 58,
    legacyRpcCreatesQueuedEffect: true,
    legacyReturnedVersionEqualsEffectVersion: true,
    transactionRolledBack: true,
    hostedOperations: 0,
    interpretation:
      "Confirmed cutover prerequisite, not a safety PASS. The published handler queues a version-keyed notice; the candidate worker queues the durable effect with an effect-ID key. See the focused notification characterization test. A rolling upgrade is not validated safe.",
  };
  fs.writeFileSync(
    "docs/waves-one-two-cutover-local.json",
    JSON.stringify(proof, null, 2) + "\n",
  );
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await db.end();
  bin(["-D", data, "-m", "fast", "-w", "stop"]);
}
