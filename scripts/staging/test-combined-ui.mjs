// Disposable native PG17 only. Hosted Auth/perimeter are NOT represented here.
import assert from "node:assert/strict";
import fs from "node:fs";
import process from "node:process";
import console from "node:console";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { UiExecutor, schemaSql } from "./combined-ui/engine.mjs";
import { UiJournal } from "./combined-ui/journal.mjs";
import {
  plan,
  ids,
  authIds,
  binding,
  sha,
  authorization,
  manifestHash,
} from "./combined-ui/policy.mjs";
import { seed, cleanup } from "./combined-ui/fixtures.mjs";
import { runCases, envelope } from "./combined-ui/cases.mjs";
import { localHttp } from "./combined-ui/local-http.mjs";
import { postcheck } from "./combined-ui/postcheck.mjs";
import { networkRead, nodeEndpoint } from "./combined-ui/network.mjs";
import { localBrowser } from "./combined-ui/local-browser.mjs";
import { executorHash } from "./combined-ui/private.mjs";
const executedCodeSeal = executorHash();
const runtime = process.env.STUDIO_LOCAL_PG_RUNTIME;
assert(runtime);
const { Client } = createRequire(join(runtime, "package.json"))("pg");
const { initdb, pg_ctl } = await import(
  pathToFileURL(
    join(runtime, "node_modules/@embedded-postgres/windows-x64/dist/index.js"),
  ).href
);
const root = join(runtime, "combined-ui-" + Date.now()),
  data = join(root, "data");
fs.mkdirSync(root);
const bin = (path, args) =>
  execFileSync(path, args, { stdio: "ignore", windowsHide: true });
bin(initdb, [
  "-D",
  data,
  "-U",
  "postgres",
  "-A",
  "trust",
  "--encoding=UTF8",
  "--locale=C",
]);
bin(pg_ctl, [
  "-D",
  data,
  "-l",
  join(root, "postgres.log"),
  "-o",
  "-h 127.0.0.1 -p 56439 -c wal_level=logical -c studio.combined_disposable=focused-ui",
  "-w",
  "start",
]);
const config = {
  host: "127.0.0.1",
  port: 56439,
  user: "postgres",
  database: "ui_combined",
};
let db, journal, transport;
const passed = [];
try {
  const admin = new Client({ ...config, database: "postgres" });
  await admin.connect();
  await admin.query("create database ui_combined");
  await admin.end();
  db = new Client(config);
  await db.connect();
  assert.equal(
    (await db.query("select current_setting('studio.combined_disposable') v"))
      .rows[0].v,
    "focused-ui",
  );
  const bootstrap = fs
    .readFileSync("scripts/staging/test-recurring-crlf-recovery.mjs", "utf8")
    .replace(/\r\n/g, "\n")
    .match(/await client\.query\(`(create role anon;[\s\S]*?)`\);/)[1];
  await db.query(bootstrap);
  const files = fs
    .readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.equal(files.length, 58);
  for (const f of files)
    await db.query(
      fs
        .readFileSync(join("supabase/migrations", f), "utf8")
        .replace(/\r\n/g, "\n"),
    );
  await db.query("set search_path=pg_catalog");
  await db.query(
    "insert into public.studios(id,name,slug) values($1,'Focused local','focused-local')",
    [plan.target.studio],
  );
  await db.query(
    "insert into public.students(id,studio_id,full_name) values('11111111-1111-4111-8111-111111111111',$1,'Preserved original')",
    [plan.target.studio],
  );
  const expectedSeal = (await db.query(schemaSql())).rows[0].digest;
  const directory = join(root, "journal");
  fs.mkdirSync(directory);
  journal = new UiJournal(directory, "local-focused-validation", plan.target);
  transport = await localHttp({ config, runtime });
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
  const args = {
    db,
    journal,
    attest: async () => assert.equal(config.host, "127.0.0.1"),
    http: transport.send,
    auth,
    expectedSeal,
  };
  let e = new UiExecutor(args);
  await e.initialize();
  await seed(e);
  passed.push("full_58_schema_seed_two_guardian_contexts");
  await assert.rejects(
    e.sql("deny.unknown", () =>
      db.query(
        "insert into public.students(id,studio_id,full_name) values($1,$2,'Unknown')",
        [ids.unavailable, plan.target.studio],
      ),
    ),
    /Unknown\/unowned/,
  );
  passed.push("unknown_record_rolls_back");
  await assert.rejects(
    e.sql("deny.baseline", () =>
      db.query(
        "update public.students set full_name='Wrong' where id='11111111-1111-4111-8111-111111111111'",
      ),
    ),
    /Original business row/,
  );
  passed.push("original_preimage_preserved");
  if (process.env.UI_BROWSER_DIST) {
    const lane = await localBrowser({
      e,
      transport,
      dist: process.env.UI_BROWSER_DIST,
      output: root,
    });
    try {
      await runCases(e, lane.driver);
    } catch (error) {
      fs.writeFileSync(
        join(root, "browser-failure.txt"),
        await lane.driver.page.locator("body").innerText(),
      );
      console.error(
        "Local browser evidence:",
        join(root, "browser-failure.txt"),
      );
      throw error;
    } finally {
      await lane.close();
    }
  } else await runCases(e, { submit: (n, p, b) => e.http(n, p, b) });
  assert.deepEqual(
    journal.events.filter((x) => x.type === "case").map((x) => x.name),
    ["UI05", "UI06", "UI07", "UI08"],
  );
  passed.push(
    "ui05_08_real_handlers_replay_stale_deletion_credit_cancel_revocation",
  );
  assert(
    !journal.events.some((x) => x.type === "case" && /^UI0[1-4]$/.test(x.name)),
  );
  passed.push("historical_cases_not_repeated_or_fabricated");
  let interrupted = false;
  e.inject = async (type, name) => {
    if (
      type === "after-sql-commit" &&
      name === "local.interrupt" &&
      !interrupted
    ) {
      interrupted = true;
      throw Error("Local simulated interruption");
    }
  };
  await assert.rejects(
    e.sql("local.interrupt", async () => ({ unchanged: true })),
    /simulated interruption/,
  );
  journal.close();
  journal = new UiJournal(directory, "local-focused-validation", plan.target);
  e = new UiExecutor({ ...args, journal });
  await e.initialize();
  assert(journal.find("committed", "local.interrupt")?.recovered);
  passed.push("committed_interruption_recovered_without_resend");
  const staleItem = e
    .ownRows("lesson_ops.lesson_bulk_items")
    .find((i) => ["conflicted", "skipped"].includes(i.status));
  assert(staleItem);
  await e.sql("local.pending-cleanup", async () => {
    const r = await db.query(
      "update lesson_ops.lesson_bulk_items set status='pending',finished_at=null where id=$1",
      [staleItem.id],
    );
    assert.equal(r.rowCount, 1);
    return { localSyntheticPendingItem: staleItem.id };
  });
  e.inject = async (type, name) => {
    if (type === "after-sql-commit" && name === "cleanup.terminal")
      throw Error("Local interrupted cleanup");
  };
  await assert.rejects(cleanup(e), /Local interrupted cleanup/);
  journal.close();
  journal = new UiJournal(directory, "local-focused-validation", plan.target);
  e = new UiExecutor({ ...args, journal });
  await e.initialize();
  assert(journal.find("committed", "cleanup.terminal")?.recovered);
  passed.push("partial_cleanup_resumes_without_repeating_committed_mutation");
  const proof = await cleanup(e);
  assert.equal(
    e.ownRows("lesson_ops.lesson_bulk_items").find((i) => i.id === staleItem.id)
      .reason_code,
    "synthetic_cleanup_abandoned",
  );
  await postcheck({
    db,
    baseline: e.baseline,
    retained: proof.retained,
    read: () => e.read(),
  });
  assert(e.ownRows("public.notes").length === 2);
  assert(e.ownRows("public.materials").length === 1);
  assert.equal(e.ownRows("public.lessons").length, 11);
  passed.push(
    "independent_76_table_cleanup_retains_authored_financial_history",
  );
  const target = {
    ...plan.target,
    origin:
      "https://" + plan.target.deployment + "--coachd-staging.netlify.app",
    artifactHash: "a".repeat(64),
  };
  binding(target);
  const approval = {
    runId: plan.runId,
    target,
    manifestHash,
    executorHash: "a".repeat(64),
    baselineHash: sha(e.baseline),
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    scope: "UI05-UI08+WAVE2",
    allowCleanup: true,
    approvedBy: "User coordinated release authorization",
  };
  authorization(approval, target, "a".repeat(64));
  assert.throws(() =>
    authorization(
      { ...approval, expiresAt: new Date(Date.now() - 1000).toISOString() },
      target,
      "a".repeat(64),
    ),
  );
  assert.throws(() =>
    authorization(
      { ...approval, manifestHash: "b".repeat(64) },
      target,
      "a".repeat(64),
    ),
  );
  passed.push("expired_or_changed_receipt_denied");
  assert.throws(() => binding({ ...target, project: "htwthzshhilrjtqwprlo" }));
  assert.throws(() => binding({ ...target, studio: ids.student }));
  assert(!nodeEndpoint("POST", target.origin + "/api/calendar-worker", target));
  assert(
    !networkRead(
      "POST",
      "https://htwthzshhilrjtqwprlo.supabase.co/rest/v1/rpc/studio_global_search",
      { p_query: plan.runId },
      target,
      e,
    ),
  );
  assert(
    !networkRead(
      "POST",
      "https://lrxrivfqjpkvygozphoz.supabase.co/rest/v1/rpc/studio_global_search",
      {
        p_query: plan.runId,
        p_student: "11111111-1111-4111-8111-111111111111",
      },
      target,
      e,
    ),
  );
  passed.push("production_foreign_studio_provider_and_unapproved_rpc_denied");
  const budgetDir = join(root, "budget");
  fs.mkdirSync(budgetDir);
  const cap = new UiJournal(budgetDir, "local-focused-validation", plan.target);
  try {
    for (let i = 0; i < plan.budgets.browserReadCeiling; i++)
      cap.reserve("read", plan.budgets.readRequests);
    const browserGuard = new UiExecutor({ ...args, journal: cap });
    assert.throws(() => browserGuard.browserRead(), /preserve remaining reads/);
    assert(plan.budgets.readRequests - cap.count("read") >= 99);
    passed.push("browser_cutoff_preserves_independently_charged_cleanup_reads");
    while (cap.count("read") < plan.budgets.readRequests) browserGuard.read();
    assert.throws(() => cap.reserve("read", plan.budgets.readRequests));
    assert.equal(cap.count("read"), plan.budgets.readRequests);
  } finally {
    cap.close();
  }
  passed.push("independent_new_read_hard_ceiling");
  const result = {
    status: "PASS",
    localOnly: true,
    postgres: 17,
    migrations: 58,
    scenarios: passed,
    requests: Object.fromEntries(
      [
        "read",
        "sql",
        "http-total",
        "http-business",
        "cleanup",
        "auth-admin",
      ].map((k) => [k, journal.count(k)]),
    ),
    baselineHash: sha(e.baseline),
    hostedAuthOrBrowserClaimed: false,
    localBrowsers: process.env.UI_BROWSER_DIST ? ["chromium", "webkit"] : [],
    executorHash: executedCodeSeal,
  };
  assert.equal(
    executorHash(),
    executedCodeSeal,
    "Executor source changed during validation",
  );
  fs.writeFileSync(
    "docs/waves-one-two-focused-executor-local.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  journal?.close();
  await transport?.close();
  await db?.end();
  bin(pg_ctl, ["-D", data, "-m", "fast", "-w", "stop"]);
}
