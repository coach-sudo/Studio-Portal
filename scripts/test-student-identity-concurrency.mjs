// Only this named disposable PostgreSQL container and owned synthetic fixture.
import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
const executable = process.platform === "win32" ? "wsl" : "docker";
const prefix = process.platform === "win32" ? ["--exec", "docker"] : [];
const args = [
  ...prefix,
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
];
const sql = (input) =>
  execFileSync(executable, args, {
    input,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
assert.match(sql("select version();"), /PostgreSQL 17\./);
const id = (n) => "e8710000-0000-4000-8000-" + String(n).padStart(12, "0"),
  studio = id(1),
  actor = id(2);
assert.equal(
  sql(`select count(*) from public.studios where id='${studio}'`),
  "0",
);
sql(`begin;
insert into auth.users(id,email) values('${actor}','e2e-identity-concurrency@example.test');
insert into public.studios(id,name,slug) values('${studio}','E2E identity concurrency','e2e-identity-concurrency');
insert into public.memberships(studio_id,user_id,role,display_name) values('${studio}','${actor}','coach','E2E coach');
insert into public.students(id,studio_id,full_name,status) values ${[10, 11, 12, 13, 14, 15, 16].map((n) => `('${id(n)}','${studio}','E2E identity ${n}','active')`).join(",")};
commit;`);
const authenticated = `begin;set local role authenticated;set local request.jwt.claim.sub='${actor}';`;
// Synthetic JSON is quoted as a SQL value, never interpolated into a shell.
const literal = (value) =>
  "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
const value = (current, duplicate) => ({
  action: "group",
  currentStudentId: id(current),
  duplicateStudentId: id(duplicate),
  reason: "Explicit synthetic identity concurrency",
});
const preview = (proposal) =>
  JSON.parse(
    sql(
      authenticated +
        `select public.preview_student_identity_change(${literal(proposal)});commit;`,
    ),
  );
const command = (proposal, stamp, key) =>
  `select public.command_student_identity_change(${literal(proposal)},'${stamp}','${key}');`;
function session(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (x) => (stdout += x));
    child.stderr.on("data", (x) => (stderr += x));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}
async function observed(application, wait) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (
      sql(
        `select exists(select 1 from pg_stat_activity where application_name='${application}' and ${wait})`,
      ) === "t"
    )
      return;
    await pause(50);
  }
  throw Error("No observed PostgreSQL contention for " + application);
}
const result = (outcome) =>
  JSON.parse(outcome.stdout.split("\n").find((line) => line.startsWith("{")));
try {
  const firstValue = value(10, 11),
    firstStamp = preview(firstValue).stamp;
  const first = session(
    authenticated +
      "set local application_name='e2e-identity-first';" +
      command(firstValue, firstStamp, "e2e-identity-same-key") +
      "select pg_sleep(3);commit;",
  );
  await observed("e2e-identity-first", "wait_event='PgSleep'");
  const second = session(
    authenticated +
      "set local application_name='e2e-identity-second';" +
      command(firstValue, firstStamp, "e2e-identity-same-key") +
      "commit;",
  );
  await observed("e2e-identity-second", "wait_event_type='Lock'");
  const same = await Promise.all([first, second]);
  for (const out of same) assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(result(same[0]), result(same[1]));
  assert.equal(
    sql(
      `select count(*) from workspace_internal.student_identity_receipts where studio_id='${studio}'`,
    ),
    "1",
  );
  assert.equal(
    sql(
      `select count(*) from workspace_internal.student_identity_groups where studio_id='${studio}'`,
    ),
    "1",
  );
  const changed = await session(
    authenticated +
      command(
        { ...firstValue, reason: "Changed synthetic identity request" },
        firstStamp,
        "e2e-identity-same-key",
      ) +
      "commit;",
  );
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /IDEMPOTENCY_CONFLICT/);
  const nextValue = value(12, 13),
    nextStamp = preview(nextValue).stamp;
  const nextFirst = session(
    authenticated +
      "set local application_name='e2e-identity-new-first';" +
      command(nextValue, nextStamp, "e2e-identity-new-key-one") +
      "select pg_sleep(3);commit;",
  );
  await observed("e2e-identity-new-first", "wait_event='PgSleep'");
  const nextSecond = session(
    authenticated +
      "set local application_name='e2e-identity-new-second';" +
      command(nextValue, nextStamp, "e2e-identity-new-key-two") +
      "commit;",
  );
  await observed("e2e-identity-new-second", "wait_event_type='Lock'");
  const [won, stale] = await Promise.all([nextFirst, nextSecond]);
  assert.equal(won.status, 0, won.stderr);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /VERSION_CONFLICT/);
  const leftValue = value(14, 16),
    rightValue = value(15, 16),
    leftStamp = preview(leftValue).stamp,
    rightStamp = preview(rightValue).stamp;
  const left = session(
    authenticated +
      "set local application_name='e2e-identity-shared-first';" +
      command(leftValue, leftStamp, "e2e-identity-shared-one") +
      "select pg_sleep(3);commit;",
  );
  await observed("e2e-identity-shared-first", "wait_event='PgSleep'");
  const right = session(
    authenticated +
      "set local application_name='e2e-identity-shared-second';" +
      command(rightValue, rightStamp, "e2e-identity-shared-two") +
      "commit;",
  );
  await observed("e2e-identity-shared-second", "wait_event_type='Lock'");
  const [joined, held] = await Promise.all([left, right]);
  assert.equal(joined.status, 0, joined.stderr);
  assert.notEqual(held.status, 0);
  assert.match(held.stderr, /VERSION_CONFLICT/);
  assert.equal(
    sql(
      `select count(*) from workspace_internal.student_identity_members where student_id='${id(16)}' and ended_at is null`,
    ),
    "1",
  );
  assert.equal(
    sql(`select count(*) from public.students where studio_id='${studio}'`),
    "7",
  );
  assert.equal(
    sql(
      `select count(*) from public.outbox_messages where studio_id='${studio}'`,
    ),
    "0",
  );
  assert.equal(
    sql(
      `select count(*) from public.payment_entries where student_id in(select id from public.students where studio_id='${studio}')`,
    ),
    "0",
  );
  console.log(
    "PASS: observed same-key replay shares one group/receipt; changed payload conflicts; competing keys and shared-profile grouping reject stale previews; all original students survive with no financial or notification effect.",
  );
} finally {
  assert.equal(
    sql(
      `select count(*) from public.students where studio_id='${studio}' and full_name not like 'E2E identity %'`,
    ),
    "0",
    "Cleanup ownership fence",
  );
  sql(`begin;
delete from workspace_internal.student_identity_receipts where studio_id='${studio}';
delete from workspace_internal.student_identity_revisions where group_id in(select id from workspace_internal.student_identity_groups where studio_id='${studio}');
delete from workspace_internal.student_identity_members where group_id in(select id from workspace_internal.student_identity_groups where studio_id='${studio}');
delete from workspace_internal.student_identity_groups where studio_id='${studio}';
delete from public.audit_events where studio_id='${studio}';
delete from credit_internal.credit_coverage_jobs where student_id in(select id from public.students where studio_id='${studio}');
delete from public.students where studio_id='${studio}';
delete from public.memberships where studio_id='${studio}';
delete from public.studios where id='${studio}';
delete from auth.users where id='${actor}';commit;`);
  assert.equal(
    sql(`select count(*) from public.studios where id='${studio}'`),
    "0",
  );
}
