// Only the named disposable Supabase container is supported. No remote URLs.
import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { execFileSync, spawn } from "node:child_process";
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
} finally {
  assert.equal(
    sql(
      `select count(*) from public.lessons where studio_id='${studio}' and topic not like 'e2e-wave6-%'`,
    ),
    "0",
    "Cleanup ownership fence",
  );
  sql(`begin;
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
