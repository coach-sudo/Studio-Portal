// Only the isolated local Supabase Docker container can be targeted.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
const containers = execFileSync(
  "docker",
  ["ps", "--filter", "name=supabase_db_studio-portal", "--format", "{{.ID}}"],
  { encoding: "utf8" },
)
  .trim()
  .split(/\s+/);
assert.equal(containers.length, 1);
assert.match(containers[0], /^[a-f0-9]{12,64}$/);
const args = [
  "exec",
  "-i",
  containers[0],
  "psql",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-qAt",
  "-v",
  "ON_ERROR_STOP=1",
];
const query = (sql) =>
  execFileSync("docker", args, { input: sql, encoding: "utf8" }).trim();
function session(sql, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args);
    let output = "",
      error = "";
    child.stdout.on("data", (data) => {
      output += data;
      onOutput(output);
    });
    child.stderr.on("data", (data) => {
      error += data;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code ? reject(new Error(error)) : resolve(output),
    );
    child.stdin.end(sql);
  });
}
const coach = "b1000000-0000-4000-8000-000000000001",
  studio = "b2000000-0000-4000-8000-000000000001",
  student = "b3000000-0000-4000-8000-000000000001",
  first = "b6000000-0000-4000-8000-000000000001",
  next = "b6000000-0000-4000-8000-000000000002",
  booked = "b6000000-0000-4000-8000-000000000003",
  booking = "b5000000-0000-4000-8000-000000000001",
  service = "b4000000-0000-4000-8000-000000000001";
async function contend(holderSql, racerSql, label, holderAfter = "") {
  let ready;
  const acquired = new Promise((resolve) => {
    ready = resolve;
  });
  const a = session(
    "begin;set local lock_timeout='8s';set local statement_timeout='20s';set application_name='occurrence-holder';" +
      holderSql +
      "select 'held';select pg_sleep(3);" +
      holderAfter +
      "commit;",
    (output) => {
      if (output.includes("held")) ready();
    },
  );
  await Promise.race([
    acquired,
    a.then(() => {
      throw new Error("Holder exited before acquiring the test lock");
    }),
  ]);
  const b = session(
    "begin;set local lock_timeout='8s';set local statement_timeout='20s';set application_name='occurrence-racer';" +
      racerSql +
      "commit;",
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(
    query(
      "select count(*) from pg_stat_activity where application_name='occurrence-racer' and wait_event_type='Lock';",
    ),
    "1",
    label + " actually waits on a PostgreSQL lock",
  );
  return await Promise.all([a, b]);
}
try {
  query(`begin;insert into auth.users(id,email) values('${coach}','e2e-occurrence-concurrency@example.test');
    insert into studios(id,name,slug) values('${studio}','Occurrence concurrency','e2e-occurrence-concurrency');
    insert into memberships(studio_id,user_id,role,display_name) values('${studio}','${coach}','coach','Concurrency coach');
    insert into students(id,studio_id,full_name) values('${student}','${studio}','Concurrency student');
    insert into student_credit_accounts(student_id,auto_apply) values('${student}',true);
    insert into lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider) values
      ('${first}','${studio}','${student}','First',now()+interval '2 days',now()+interval '2 days 1 hour','scheduled','in_person','Studio','studio'),
      ('${next}','${studio}','${student}','Next',now()+interval '9 days',now()+interval '9 days 1 hour','scheduled','in_person','Studio','studio');
    select command_grant_student_credits('${student}','occurrence-concurrent-grant','{"quantity":1,"kind":"adjustment","reason":"Concurrency credit"}','${coach}');commit;`);
  const cancel = `select command_cancel_lesson_credit('${first}',(select version from lessons where id='${first}'),false)->>'duplicate';`;
  await contend(
    cancel,
    `select reserve_student_upcoming_credits('${student}')->>'applied';`,
    "Cancellation versus coverage",
  );
  assert.equal(
    query(
      `select sum(quantity) from package_credit_entries where lesson_id='${first}';`,
    ),
    "0",
  );
  assert.equal(
    query(
      `select sum(quantity) from package_credit_entries where lesson_id='${next}';`,
    ),
    "-1",
  );
  assert.equal(
    query(
      `select count(*) from package_credit_entries where lesson_id='${next}' and quantity<0;`,
    ),
    "1",
  );
  const value = {
    lessonId: next,
    action: "cancel",
    scope: "occurrence",
    reason: "Concurrent reviewed cancellation",
    useCredit: false,
    wholeClass: false,
  };
  value.reviewToken = JSON.parse(
    query(
      `select preview_lesson_occurrence_change('${coach}','${JSON.stringify(value)}')->'reviewToken';`,
    ),
  );
  const execute = `select execute_lesson_occurrence_change('${coach}','concurrent-reviewed-key','${JSON.stringify(value)}')->>'duplicate';`;
  const [changed, replayed] = await contend(
    execute,
    execute,
    "Overlapping reviewed execution",
  );
  assert.match(changed, /false/);
  assert.match(replayed, /true/);
  assert.equal(
    query(
      `select count(*) from audit_events where entity_id='${next}' and action='lesson.cancelled';`,
    ),
    "1",
  );
  const claim = JSON.parse(
    query(
      `select projection from claim_calendar_projections(25) where lesson->>'id'='${first}';`,
    ),
  );
  const finish = `select finish_calendar_projection('${claim.id}','${claim.claim_token}','{"id":"concurrent-event","etag":"etag"}');`;
  const [, late] = await contend(
    `update lessons set version=version+1 where id='${first}';`,
    finish,
    "Calendar completion versus occurrence version",
  );
  assert.match(late, /f/);
  assert.equal(
    query(
      `select status||':'||external_event_id from calendar_projections where lesson_id='${first}';`,
    ),
    "queued:concurrent-event",
  );
  assert.equal(
    query(
      `select count(*) from lesson_ops.effects where lesson_id in ('${first}','${next}');`,
    ),
    "2",
  );
  console.log(
    "PostgreSQL cancellation/coverage, reviewed replay, and stale calendar completion passed (separate sessions; observed contention).",
  );
  query(`begin;
    insert into booking_services(id,studio_id,slug,name,category,duration_minutes) values('${service}','${studio}','concurrent-booking','Concurrent service','private',60);
    insert into bookings(id,studio_id,student_id,service_id,reference,guest_name,guest_email,starts_at,ends_at,timezone,location,status,payment_policy,payment_status,total_minor,policy_snapshot,manage_token_hash)
      values('${booking}','${studio}','${student}','${service}','CONCURRENT-BOOKING','Student','e2e-booked@example.test',now()+interval '16 days',now()+interval '16 days 1 hour','America/New_York','in_person','confirmed','pay_later','due',0,'{"cancellationWindowHours":36}','concurrent-booking-token');
    insert into lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider) values('${booked}','${studio}','${student}','Booked concurrent lesson',now()+interval '16 days',now()+interval '16 days 1 hour','scheduled','in_person','Studio','studio');
    insert into lesson_participants(lesson_id,student_id,booking_id,display_name,email) values('${booked}','${student}','${booking}','Student','e2e-booked@example.test');
    select reserve_student_upcoming_credits('${student}');commit;`);
  await contend(
    `select id from students where id='${student}' for update;`,
    `select cancel_booking_credit('${booking}',(select version from bookings where id='${booking}'),false,true);`,
    "Booking withdrawal versus coverage",
    `select reserve_student_upcoming_credits('${student}')->>'applied';`,
  );
  assert.equal(
    query(
      `select sum(quantity) from package_credit_entries where lesson_id='${booked}';`,
    ),
    "0",
  );
  assert.equal(
    query(
      `select count(*) from package_credit_entries where lesson_id='${booked}' and quantity<0;`,
    ),
    "1",
  );
  console.log(
    "PostgreSQL booking withdrawal/coverage also passed with observed lock contention and one released debit.",
  );
} finally {
  query(`begin;delete from lesson_ops.effects where lesson_id in ('${first}','${next}','${booked}');delete from lesson_ops.receipts where studio_id='${studio}';
    delete from credit_internal.credit_command_receipts where student_id='${student}';delete from credit_internal.credit_coverage_jobs where student_id='${student}';
    delete from audit_events where studio_id='${studio}';delete from package_credit_entries where package_id in(select id from packages where student_id='${student}');
    delete from lesson_participants where lesson_id in ('${first}','${next}','${booked}');delete from calendar_projections where lesson_id in ('${first}','${next}','${booked}');
    delete from bookings where id='${booking}';delete from booking_services where id='${service}';
    delete from lessons where studio_id='${studio}';delete from packages where student_id='${student}';delete from student_credit_accounts where student_id='${student}';
    delete from students where id='${student}';delete from memberships where studio_id='${studio}';delete from studios where id='${studio}';delete from auth.users where id='${coach}';commit;`);
}
