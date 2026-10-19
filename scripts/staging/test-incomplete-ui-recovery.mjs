// Disposable PG17 only; Auth Admin calls are an explicitly local adapter.
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { UiExecutor, schemaSql, snapshot } from "./ui/engine.mjs";
import { UiJournal } from "./ui/journal.mjs";
import { seed } from "./ui/fixtures.mjs";
import { runCases } from "./ui/cases.mjs";
import { localHttp } from "./ui/local-http.mjs";
import { postcheck } from "./ui/postcheck.mjs";
import { plan, authIds, ids, sha } from "./ui/policy.mjs";
import {
  originalJournal,
  RecoveryJournal,
  IncompleteRecovery,
  recoverIncomplete,
  recoveryApproval,
  recoveryCaps,
} from "./incomplete-ui-recovery.mjs";
import { reviewedExecutor } from "./incomplete-ui-hosted.mjs";
const runtime = process.env.STUDIO_LOCAL_PG_RUNTIME;
assert(runtime);
const { Client } = createRequire(join(runtime, "package.json"))("pg");
const { initdb, pg_ctl } = await import(
  pathToFileURL(
    join(runtime, "node_modules/@embedded-postgres/windows-x64/dist/index.js"),
  ).href
);
const root = join(runtime, "cleanup-recovery-" + Date.now()),
  data = join(root, "data");
fs.mkdirSync(root);
const run = (bin, args) =>
  execFileSync(bin, args, { stdio: "ignore", windowsHide: true });
run(initdb, [
  "-D",
  data,
  "-U",
  "postgres",
  "-A",
  "trust",
  "--encoding=UTF8",
  "--locale=C",
]);
run(pg_ctl, [
  "-D",
  data,
  "-l",
  join(root, "postgres.log"),
  "-o",
  "-h 127.0.0.1 -p 56437 -c wal_level=logical -c studio.cleanup_disposable=ui-recovery",
  "-w",
  "start",
]);
const config = {
  host: "127.0.0.1",
  port: 56437,
  user: "postgres",
  database: "ui_recovery",
};
const admin = new Client({ ...config, database: "postgres" });
let db, transport, journal, recovery;
const passed = [];
const pass = (name) => {
  passed.push(name);
  console.log("PASS", name);
};
try {
  await admin.connect();
  assert.equal(
    (await admin.query("select current_setting('studio.cleanup_disposable') v"))
      .rows[0].v,
    "ui-recovery",
  );
  await admin.query("create database ui_recovery");
  db = new Client(config);
  await db.connect();
  const bootstrap = fs
    .readFileSync("scripts/staging/test-recurring-crlf-recovery.mjs", "utf8")
    .replace(/\r\n/g, "\n")
    .match(/await client\.query\(`(create role anon;[\s\S]*?)`\);/)[1];
  await db.query(bootstrap);
  const migrations = fs
    .readdirSync("supabase/migrations")
    .filter(
      (f) => f.endsWith(".sql") && !f.includes("workspace_navigation_search"),
    )
    .sort();
  assert.equal(migrations.length, 57);
  for (const f of migrations)
    await db.query(
      fs
        .readFileSync(join("supabase/migrations", f), "utf8")
        .replace(/\r\n/g, "\n"),
    );
  await db.query("set search_path=pg_catalog");
  await db.query(
    "insert into public.studios(id,name,slug) values($1,'Recovery local','recovery-local')",
    [plan.target.studio],
  );
  const installed = Object.values(await snapshot(db)).reduce(
    (n, rows) => n + rows.length,
    0,
  );
  assert(installed < 215);
  await db.query(
    "insert into public.students(studio_id,full_name) select $1,'Protected original '||n from generate_series(1,$2::integer) n",
    [plan.target.studio, 215 - installed],
  );
  const seal = (await db.query(schemaSql())).rows[0].digest;
  const directory = join(root, "original");
  fs.mkdirSync(directory);
  journal = new UiJournal(directory, reviewedExecutor, plan.target);
  const auth = {
    create: async (_role, a) =>
      db.query(
        "insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),$3)",
        [a.id, a.email, { acceptanceRun: plan.runId }],
      ),
    remove: async (role, id) => {
      assert.equal(id, authIds[role]);
      if (role === "coach")
        await db.query(
          "update auth.users set raw_app_meta_data=raw_app_meta_data||'{\"localBanned\":true}'::jsonb where id=$1",
          [id],
        );
      else await db.query("delete from auth.users where id=$1", [id]);
    },
  };
  transport = await localHttp({ config, runtime });
  const e = new UiExecutor({
    db,
    journal,
    attest: async () => {},
    http: transport.send,
    auth,
    expectedSeal: seal,
  });
  await e.initialize();
  await seed(e);
  const capture = e.capture.bind(e);
  let deleteCaptures = 0;
  e.capture = async () => {
    if (
      e.activeSql?.startsWith("process.") &&
      e.jobs.get(e.activeSql.slice(8))?.operation === "delete" &&
      ++deleteCaptures === 2
    )
      throw Error("SIMULATED_READ_LIMIT");
    return capture();
  };
  await assert.rejects(
    runCases(e, { submit: (name, path, body) => e.http(name, path, body) }),
    /SIMULATED_READ_LIMIT/,
  );
  assert.equal(journal.events.filter((x) => x.type === "case").length, 4);
  assert.equal(e.jobs.size, 3);
  assert(
    e.ownRows("public.lessons").some((l) => l.id === ids["lesson-delete"]),
  );
  pass("57 migrations and genuine UI01-UI04 plus interrupted UI05 fixture");
  journal.close();
  journal = undefined;
  const original = originalJournal(
      join(directory, "ui-journal.jsonl"),
      reviewedExecutor,
    ),
    oldDigest = original.digest;
  const dir = join(root, "recovery");
  fs.mkdirSync(dir);
  let fresh = new UiJournal(dir, reviewedExecutor, plan.target);
  recovery = new RecoveryJournal(original, fresh);
  const baseQuery = db.query.bind(db);
  db.query = async (...args) => {
    if (/^\s*(select|with|show)\b/i.test(args[0])) recovery.reserve("read");
    return baseQuery(...args);
  };
  const make = async (inject) => {
    const result = new IncompleteRecovery({
      db,
      journal: recovery,
      attest: async () => {},
      auth,
      http: async () => {
        throw Error("forbidden");
      },
      expectedSeal: seal,
      initialBaselineHash: sha(original.baseline),
      inject,
    });
    await result.initialize();
    return result;
  };
  let current = await make();
  await db.query("begin");
  await db.query(
    "update public.students set full_name='Unknown writer' where id=(select id from public.students where id<>all($1::uuid[]) limit 1)",
    [[ids.student, ids["other-student"]]],
  );
  await assert.rejects(
    current.capture().then((x) => current.verify(x, false)),
    /Original business row changed/,
  );
  await db.query("rollback");
  pass("original row drift rejected before cleanup");
  current = await make(async (stage, name) => {
    if (
      stage === "after-sql-commit" &&
      name === "cleanup.reconcile_incomplete_jobs"
    )
      throw Error("INTERRUPTED_RECONCILIATION");
  });
  await assert.rejects(
    recoverIncomplete(current),
    /INTERRUPTED_RECONCILIATION/,
  );
  current = await make(async (stage, name) => {
    if (
      stage === "after-sql-commit" &&
      name === "cleanup.public.calendar_projections"
    )
      throw Error("INTERRUPTED_PARTIAL_CLEANUP");
  });
  await assert.rejects(
    recoverIncomplete(current),
    /INTERRUPTED_PARTIAL_CLEANUP/,
  );
  pass(
    "committed interruption reconciled by exact durable snapshot without resend",
  );
  current = await make();
  const proof = await recoverIncomplete(current);
  pass("partial cleanup resumes canonically with retained ledger and history");
  const independent = await postcheck({
    db,
    baseline: original.baseline,
    retained: proof.retained,
  });
  assert(independent.originalRowsUnchanged);
  assert.equal(
    originalJournal(join(directory, "ui-journal.jsonl"), reviewedExecutor)
      .digest,
    oldDigest,
  );
  assert.equal(
    (await db.query("select count(*) n from auth.users")).rows[0].n,
    "1",
  );
  pass(
    "independent 76-table fingerprints, Auth cleanup and immutable original journal",
  );
  await assert.rejects(current.http(), /forbidden/i);
  assert.throws(() => recovery.reserve("http-total"), /forbidden/);
  pass("application requests and new acceptance activity rejected");
  const receipt = {
    scope: "INCOMPLETE_UI_CLEANUP_ONLY",
    binding: { project: plan.target.project },
    budgets: recoveryCaps,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10000).toISOString(),
    approvedBy: "local test",
    approvalSourceHash: "test",
  };
  assert.throws(
    () => recoveryApproval(receipt, { project: "production" }),
    /binding changed/,
  );
  assert.throws(
    () =>
      recoveryApproval(
        { ...receipt, expiresAt: new Date(0).toISOString() },
        receipt.binding,
      ),
    /expired/,
  );
  pass("off-target and expired receipt rejection");
  const before = recovery.count("read");
  for (let i = before; i < 300; i++) recovery.reserve("read");
  assert.throws(() => recovery.reserve("read"), /Budget exceeded/);
  assert.equal(recovery.count("read"), 300);
  pass("independent hard read ceiling cannot be reset or overrun");
  const result = {
    status: "PASS",
    postgres: 17,
    migrations: 57,
    tests: passed,
    hostedConnections: 0,
    authAdapter: "LOCAL_ONLY",
    originalRows: 215,
    originalJournalUnchanged: true,
  };
  fs.writeFileSync(
    "docs/waves-one-two-recovery-local.json",
    JSON.stringify(result, null, 2) + "\n",
  );
} finally {
  journal?.close();
  recovery?.journal.close();
  await transport?.close();
  await db?.end();
  await admin.end();
  run(pg_ctl, ["-D", data, "-m", "fast", "-w", "stop"]);
}
