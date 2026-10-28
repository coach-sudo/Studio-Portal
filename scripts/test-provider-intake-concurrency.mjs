// Only the named disposable Supabase container is supported. No remote URLs.
import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
const executable = process.platform === "win32" ? "wsl" : "docker";
const prefix = process.platform === "win32" ? ["--exec", "docker"] : [];
const container = "supabase_db_studio-portal";
const sqlArgs = [
  ...prefix,
  "exec",
  "-i",
  container,
  "psql",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-X",
  "-qAt",
  "-v",
  "ON_ERROR_STOP=1",
];
const sql = (input) =>
  execFileSync(executable, sqlArgs, {
    input,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
assert.match(sql("select version();"), /PostgreSQL 17\./);
const studio = "e6800000-0000-4000-8000-000000000001",
  actor = "e6800000-0000-4000-8000-000000000002",
  signal = "e6800000-0000-4000-8000-000000000003";
assert.equal(
  sql(`select count(*) from public.studios where id='${studio}'`),
  "0",
);
sql(`insert into auth.users(id,email) values('${actor}','e2e-wave6-concurrency@example.test');
insert into public.studios(id,name,slug) values('${studio}','e2e-wave6-concurrency','e2e-wave6-concurrency');
insert into public.memberships(studio_id,user_id,role,display_name) values('${studio}','${actor}','coach','Synthetic');
insert into public.integration_imports(id,studio_id,provider,external_id,detected_source,status,payload) values('${signal}','${studio}','gmail','e2e-wave6-concurrency','lessonface','needs_review','{"candidate":{"startsAt":"2031-11-02T18:00:00Z","endsAt":"2031-11-02T19:00:00Z","topic":"e2e-wave6-concurrency"}}');`);
const command = `select public.command_review_provider_import('${signal}','{"action":"create","fullName":"e2e-wave6-concurrency"}','e2e-wave6-concurrent-key');`;
const authenticated = `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${actor}',true);`;
function session(input) {
  return new Promise((resolve, reject) => {
    const p = spawn(executable, sqlArgs, { windowsHide: true });
    let stdout = "",
      stderr = "";
    p.stdout.on("data", (data) => (stdout += data));
    p.stderr.on("data", (data) => (stderr += data));
    p.on("error", reject);
    p.on("close", (status) => resolve({ status, stdout, stderr }));
    p.stdin.end(input);
  });
}
try {
  const outcomes = await Promise.all([
    session(authenticated + command + "select pg_sleep(0.5);commit;"),
    session(authenticated + command + "commit;"),
  ]);
  outcomes.forEach((outcome) =>
    assert.equal(outcome.status, 0, outcome.stderr),
  );
  assert.equal(
    sql(`select count(*) from public.students where studio_id='${studio}'`),
    "1",
  );
  assert.equal(
    sql(`select count(*) from public.lessons where studio_id='${studio}'`),
    "1",
  );
  assert.equal(
    sql(
      `select count(*) from workspace_internal.operation_receipts where actor_id='${actor}'`,
    ),
    "1",
  );
  assert.equal(
    sql(
      `select count(*) from public.audit_events where studio_id='${studio}' and action='integration_import.confirmed'`,
    ),
    "1",
  );
  const changed = await session(
    authenticated +
      command.replace("e2e-wave6-concurrent-key", "e2e-wave6-second-key") +
      "commit;",
  );
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /VERSION_CONFLICT/);
  console.log(
    "PASS: concurrent review replay produces one student, lesson, audit and receipt; new-key replay is rejected.",
  );
  const service = "begin;set local role service_role;";
  const start = `select public.start_calendar_discovery('${actor}','${studio}','{"from":"2000-01-01T00:00:00Z","to":"2035-01-01T00:00:00Z","timezone":"UTC","calendars":[{"id":"e2e-preview-calendar"}]}','e2e-preview-concurrent-start');`;
  const starts = await Promise.all([
    session(service + start + "select pg_sleep(0.5);commit;"),
    session(service + start + "commit;"),
  ]);
  starts.forEach((r) => assert.equal(r.status, 0, r.stderr));
  assert.equal(
    sql(
      `select count(*) from discovery_internal.scans where studio_id='${studio}'`,
    ),
    "1",
  );
  const scan = sql(
    `select id from discovery_internal.scans where studio_id='${studio}'`,
  );
  const claim = `select public.claim_calendar_discovery_page('${actor}','${scan}','e2e-preview-calendar',0,'e2e-preview-concurrent-page');`;
  const claims = await Promise.all([
    session(service + claim + "select pg_sleep(0.5);commit;"),
    session(service + claim + "commit;"),
  ]);
  assert.equal(
    claims.filter((r) => r.status === 0).length,
    1,
    "Only one live page claim may win",
  );
  assert.match(claims.find((r) => r.status !== 0).stderr, /DISCOVERY_RUNNING/);
  const expired = sql(
    `select claim_token from discovery_internal.sources where scan_id='${scan}'`,
  );
  sql(
    `update discovery_internal.sources set claim_until=now()-interval '1 second' where scan_id='${scan}'`,
  );
  assert.equal((await session(service + claim + "commit;")).status, 0);
  const token = sql(
    `select claim_token from discovery_internal.sources where scan_id='${scan}'`,
  );
  assert.notEqual(token, expired);
  const body = `'{"items":[{"id":"e2e-observed-event","status":"active","summary":"Synthetic preview","reasonCode":"invalid_time_requires_review"}]}'::jsonb`;
  const stale = await session(
    service +
      `select public.finish_calendar_discovery_page('${scan}','e2e-preview-calendar',0,'${expired}',${body});commit;`,
  );
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /STALE_DISCOVERY_CLAIM/);
  const finish = `select public.finish_calendar_discovery_page('${scan}','e2e-preview-calendar',0,'${token}',${body});`;
  const checkpoints = await Promise.all([
    session(service + finish + "select pg_sleep(0.5);commit;"),
    session(service + finish + "commit;"),
  ]);
  checkpoints.forEach((r) => assert.equal(r.status, 0, r.stderr));
  assert.equal(
    sql(
      `select count(*) from discovery_internal.candidates where scan_id='${scan}'`,
    ),
    "1",
  );
  assert.equal(
    sql(
      `select count(*) from discovery_internal.page_observations where scan_id='${scan}' and outcome='completed'`,
    ),
    "1",
  );
  assert.equal(
    sql(`select count(*) from public.lessons where studio_id='${studio}'`),
    "1",
    "Preview must not add a canonical lesson",
  );
  console.log(
    "PASS: preview start/claim/checkpoint concurrency is replay-safe; expired leases recover and stale completion is fenced; no preview lesson is created.",
  );
  const historical = "e6800000-0000-4000-8000-000000000099",
    oldInsertId = "e6800000-0000-4000-8000-000000000100",
    reverseInsertId = "e6800000-0000-4000-8000-000000000101",
    protectedDecision = "e6800000-0000-4000-8000-000000000102",
    studentId = sql(
      `select id from public.students where studio_id='${studio}' order by id limit 1`,
    );
  sql(`insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label)
 values('${historical}','${studio}','${studentId}','e2e-wave6-protected-history','2020-01-01T15:00Z','2020-01-01T16:00Z','completed','in_person','E2E');`);
  const binding = (
    event,
    identity = protectedDecision,
  ) => `insert into discovery_internal.source_decisions(id,studio_id,calendar_id,event_id,disposition,lesson_id,lesson_ends_at,reviewed_hash,actor_id,reason)
 values('${identity}','${studio}','e2e-protected-calendar','${event}','linked','${historical}','2020-01-01T16:00Z',repeat('a',64),'${actor}','Explicit E2E historical source review');`;
  const rawInsert = (
    event,
    identity,
  ) => `insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider,source_external_id)
 values('${identity}','${studio}','${studentId}','e2e-wave6-old-raw-source','2020-01-02T15:00Z','2020-01-02T16:00Z','completed','in_person','E2E','google_calendar','${event}');`;
  async function observed(application, condition) {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (
        sql(
          `select count(*) from pg_stat_activity where application_name='${application}' and ${condition}`,
        ) === "1"
      )
        return;
      await pause(50);
    }
    throw Error(
      `No observed PostgreSQL contention/readiness for ${application}`,
    );
  }
  const bindingFirst = session(
    `begin;set local application_name='e2e-source-binding-first';${binding("e2e-protected-event")}select pg_sleep(4);commit;`,
  );
  await observed("e2e-source-binding-first", "wait_event='PgSleep'");
  const rawSecond = session(
    `begin;set local application_name='e2e-source-raw-second';${rawInsert("e2e-protected-event", oldInsertId)}commit;`,
  );
  await observed("e2e-source-raw-second", "wait_event_type='Lock'");
  const [bound, blockedRaw] = await Promise.all([bindingFirst, rawSecond]);
  assert.equal(bound.status, 0, bound.stderr);
  assert.notEqual(blockedRaw.status, 0);
  assert.match(blockedRaw.stderr, /protected historical decision/);
  assert.equal(
    sql(`select count(*) from public.lessons where id='${oldInsertId}'`),
    "0",
  );
  const reverseRaw = session(
    `begin;set local application_name='e2e-source-raw-first';${rawInsert("e2e-reverse-event", reverseInsertId)}select pg_sleep(4);commit;`,
  );
  await observed("e2e-source-raw-first", "wait_event='PgSleep'");
  const reverseBinding = session(
    `begin;set local application_name='e2e-source-binding-second';${binding("e2e-reverse-event", "e6800000-0000-4000-8000-000000000103")}commit;`,
  );
  await observed("e2e-source-binding-second", "wait_event_type='Lock'");
  const [rawWon, heldLink] = await Promise.all([reverseRaw, reverseBinding]);
  assert.equal(rawWon.status, 0, rawWon.stderr);
  assert.notEqual(heldLink.status, 0);
  assert.match(heldLink.stderr, /existing source record/);
  assert.equal(
    sql(
      `select count(*) from discovery_internal.source_decisions where studio_id='${studio}' and event_id='e2e-reverse-event'`,
    ),
    "0",
  );
  const observation = `select public.observe_protected_calendar_sources('${studio}','e2e-protected-calendar','[{"id":"e2e-protected-event","status":"cancelled"}]');`;
  const observeFirst = session(
    service +
      `set local application_name='e2e-source-observe-first';${observation}select pg_sleep(4);commit;`,
  );
  await observed("e2e-source-observe-first", "wait_event='PgSleep'");
  const observeSecond = session(
    service +
      `set local application_name='e2e-source-observe-second';${observation}commit;`,
  );
  await observed("e2e-source-observe-second", "wait_event_type='Lock'");
  for (const result of await Promise.all([observeFirst, observeSecond]))
    assert.equal(result.status, 0, result.stderr);
  assert.equal(
    sql(
      `select count(*) from discovery_internal.source_observations where decision_id='${protectedDecision}'`,
    ),
    "1",
  );
  assert.equal(
    sql(`select status from public.lessons where id='${historical}'`),
    "completed",
  );
  console.log(
    "PASS: observed separate-session lock contention protects both review/raw-insert orderings; concurrent source observations commit once and preserve historical outcome.",
  );
} finally {
  assert.equal(
    sql(
      `select count(*) from public.lessons where studio_id='${studio}' and topic not like 'e2e-wave6-%'`,
    ),
    "0",
    "Cleanup ownership fence",
  );
  sql(`begin;
delete from discovery_internal.source_observations where decision_id in(select id from discovery_internal.source_decisions where studio_id='${studio}');
delete from discovery_internal.source_write_authorizations where decision_id in(select id from discovery_internal.source_decisions where studio_id='${studio}');
delete from discovery_internal.source_decisions where studio_id='${studio}';
delete from discovery_internal.page_receipts where scan_id in(select id from discovery_internal.scans where studio_id='${studio}');
delete from discovery_internal.page_observations where scan_id in(select id from discovery_internal.scans where studio_id='${studio}');
delete from discovery_internal.candidates where scan_id in(select id from discovery_internal.scans where studio_id='${studio}');
delete from discovery_internal.sources where scan_id in(select id from discovery_internal.scans where studio_id='${studio}');
delete from discovery_internal.scans where studio_id='${studio}';
delete from public.calendar_projections where lesson_id in(select id from public.lessons where studio_id='${studio}');
delete from public.integration_imports where studio_id='${studio}';
delete from workspace_internal.operation_receipts where actor_id='${actor}' and studio_id='${studio}';
delete from public.audit_events where studio_id='${studio}';
delete from public.lessons where studio_id='${studio}';
delete from credit_internal.credit_coverage_jobs where student_id in(select id from public.students where studio_id='${studio}');
delete from public.students where studio_id='${studio}';
delete from public.memberships where studio_id='${studio}';
delete from public.studios where id='${studio}';
delete from auth.users where id='${actor}';
commit;`);
  assert.equal(
    sql(`select count(*) from public.studios where id='${studio}'`),
    "0",
  );
}
