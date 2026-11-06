// Disposable local Supabase container only; never accepts a remote database URL.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import process from "node:process";
import console from "node:console";
const executable = process.platform === "win32" ? "wsl" : "docker";
const args = [
  ...(process.platform === "win32" ? ["--exec", "docker"] : []),
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
  }).trim();
assert.match(sql("select version()"), /PostgreSQL 17\./);
const studio = "e7200000-0000-4000-8000-000000000010",
  actor = "e7200000-0000-4000-8000-000000000001",
  student = "e7200000-0000-4000-8000-000000000011",
  service = "e7200000-0000-4000-8000-000000000012";
assert.equal(
  sql(`select count(*) from public.studios where id='${studio}'`),
  "0",
  "Synthetic ownership fence",
);
sql(`insert into auth.users(id,email) values('${actor}','e2e-manual-concurrency@example.test');
insert into public.studios(id,name,slug,timezone) values('${studio}','e2e-manual-concurrency','e2e-manual-concurrency','America/New_York');
insert into public.memberships(studio_id,user_id,role,display_name) values('${studio}','${actor}','coach','Synthetic coach');
insert into public.students(id,studio_id,full_name,email) values('${student}','${studio}','e2e-manual-concurrency','e2e-manual-learner@example.test');
insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor) values('${service}','${studio}','e2e-manual-concurrency','e2e-manual-concurrency','private',60,6000);`);
const value = (starts) =>
  JSON.stringify({
    student_id: student,
    service_id: service,
    starts_at: starts,
    mark_paid: true,
  });
const command = (key, starts = "2031-11-03T18:00:00Z") =>
  `select public.command_create_manual_booking('${key}','${value(starts)}'::jsonb,'not_configured')->'resource'->>'id';`;
const begin = `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${actor}',true);`;
const session = (input) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let out = "",
      err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, out, err }));
    child.stdin.end(input);
  });
try {
  const results = await Promise.all([
    session(
      `${begin}${command("e2e-manual-race")}select pg_sleep(0.4);commit;`,
    ),
    session(`${begin}${command("e2e-manual-race")}commit;`),
  ]);
  results.forEach((r) => assert.equal(r.status, 0, r.err));
  assert.equal(
    sql(`select count(*) from public.bookings where studio_id='${studio}'`),
    "1",
  );
  assert.equal(
    sql(
      `select count(*) from public.payment_entries where student_id='${student}'`,
    ),
    "1",
  );
  assert.equal(
    sql(
      `select count(*) from workspace_internal.manual_booking_receipts where studio_id='${studio}'`,
    ),
    "1",
  );
  const changed = await session(
    `${begin}${command("e2e-manual-race", "2031-11-03T20:00:00Z")}commit;`,
  );
  assert.notEqual(changed.status, 0);
  assert.match(changed.err, /IDEMPOTENCY_CONFLICT/);
  const overlap = await Promise.all([
    session(
      `${begin}${command("e2e-overlap-one", "2031-11-04T18:00:00Z")}select pg_sleep(0.4);commit;`,
    ),
    session(
      `${begin}${command("e2e-overlap-two", "2031-11-04T18:00:00Z")}commit;`,
    ),
  ]);
  assert.equal(overlap.filter((r) => r.status === 0).length, 1);
  assert.match(
    overlap.find((r) => r.status !== 0).err,
    /SLOT_UNAVAILABLE|lessons_private_overlap/,
  );
  assert.equal(
    sql(`select count(*) from public.bookings where studio_id='${studio}'`),
    "2",
  );
  assert.equal(
    sql(
      `select count(*) from public.payment_entries where student_id='${student}'`,
    ),
    "2",
  );
  console.log(
    "PASS: simultaneous same-key requests commit one booking/ledger/receipt; conflicting replay is rejected; different-key concurrent overlaps commit one occurrence.",
  );
} finally {
  assert.equal(
    sql(
      `select count(*) from public.lessons where studio_id='${studio}' and topic<>'e2e-manual-concurrency'`,
    ),
    "0",
    "Cleanup ownership fence",
  );
  sql(`begin;
delete from workspace_internal.manual_booking_effects where booking_id in(select id from public.bookings where studio_id='${studio}');
delete from workspace_internal.manual_booking_receipts where studio_id='${studio}';
delete from credit_internal.credit_coverage_jobs where student_id='${student}';
delete from public.audit_events where studio_id='${studio}';
delete from public.payment_entries where student_id='${student}';
delete from public.lesson_participants where student_id='${student}';
delete from public.calendar_projections where lesson_id in(select id from public.lessons where studio_id='${studio}');
delete from public.bookings where studio_id='${studio}';delete from public.lessons where studio_id='${studio}';
delete from public.booking_services where studio_id='${studio}';delete from public.student_credit_accounts where student_id='${student}';
delete from public.students where id='${student}';delete from public.memberships where studio_id='${studio}';delete from public.studios where id='${studio}';delete from auth.users where id='${actor}';commit;`);
}
