// Runs only inside the local Supabase Docker database. No linked/remote target exists.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
const containers = execFileSync(
  "docker",
  ["ps", "--filter", "name=supabase_db_studio-portal", "--format", "{{.ID}}"],
  { encoding: "utf8" },
)
  .trim()
  .split(/\s+/);
assert.equal(
  containers.length,
  1,
  "Require exactly one isolated studio-portal database",
);
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
      output += data.toString();
      onOutput(output);
    });
    child.stderr.on("data", (data) => {
      error += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code ? reject(new Error(error)) : resolve(output),
    );
    child.stdin.end(sql);
  });
}
const coach = "91000000-0000-4000-8000-000000000001",
  studio = "92000000-0000-4000-8000-000000000001",
  student = "93000000-0000-4000-8000-000000000001";
const grant = `select public.command_grant_student_credits('${student}','concurrency-grant','{"quantity":2,"kind":"adjustment","reason":"Concurrent regression grant"}','${coach}')->>'duplicate';`;
try {
  query(`begin;
    insert into auth.users(id,email) values('${coach}','e2e-concurrency-coach@example.test');
    insert into public.studios(id,name,slug) values('${studio}','Concurrency fixture','e2e-credit-concurrency');
    insert into public.memberships(studio_id,user_id,role,display_name) values('${studio}','${coach}','coach','Concurrent coach');
    insert into public.students(id,studio_id,full_name) values('${student}','${studio}','Concurrent student');
    insert into public.student_credit_accounts(student_id,auto_apply) values('${student}',true);
    insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label)
      select '${studio}','${student}','Concurrency lesson',now()+n*interval '1 day',now()+n*interval '1 day'+interval '1 hour','scheduled','virtual','Meet' from generate_series(1,3) n;
    commit;`);
  let locked;
  const ready = new Promise((resolve) => {
    locked = resolve;
  });
  const a = session(
    `begin;set application_name='credit-reliability-holder';select id from public.students where id='${student}' for update;select 'lock_acquired';select pg_sleep(3);${grant}commit;`,
    (output) => {
      if (output.includes("lock_acquired")) locked();
    },
  );
  await ready;
  const b = session(
    `begin;set application_name='credit-reliability-racer';${grant}commit;`,
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(
    query(
      "select count(*) from pg_stat_activity where application_name='credit-reliability-racer' and wait_event_type='Lock';",
    ),
    "1",
    "The second PostgreSQL session actually contends on the student lock",
  );
  const [first, replay] = await Promise.all([a, b]);
  assert.match(first, /false/);
  assert.match(replay, /true/);
  assert.equal(
    query(
      `select count(*) from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id='${student}' and e.kind='adjustment';`,
    ),
    "1",
  );
  assert.equal(
    query(
      `select count(*) from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id='${student}' and e.quantity<0;`,
    ),
    "2",
  );
  assert.equal(
    query(
      "select count(*) from public.audit_events where correlation_id='concurrency-grant';",
    ),
    "1",
  );
  const c = session(
    `select public.reserve_student_upcoming_credits('${student}')->>'applied';`,
  );
  const d = session(
    `select public.reserve_student_upcoming_credits('${student}')->>'applied';`,
  );
  assert.deepEqual(
    (await Promise.all([c, d])).map((value) => value.trim()),
    ["0", "0"],
  );
  assert.equal(
    query(`select public.student_credit_summary('${student}')->>'remaining';`),
    "2",
  );
  console.log(
    "PostgreSQL concurrent grant/replay and repeated scans passed (two sessions, observed lock contention).",
  );
} finally {
  query(`begin;
    delete from credit_internal.credit_command_receipts where student_id='${student}';
    delete from credit_internal.credit_coverage_jobs where student_id='${student}';
    delete from public.audit_events where studio_id='${studio}';
    delete from public.package_credit_entries where package_id in(select id from public.packages where student_id='${student}');
    delete from public.lesson_participants where lesson_id in(select id from public.lessons where studio_id='${studio}');
    delete from public.calendar_projections where lesson_id in(select id from public.lessons where studio_id='${studio}');
    delete from public.lessons where studio_id='${studio}';delete from public.packages where student_id='${student}';
    delete from public.student_credit_accounts where student_id='${student}';delete from public.students where id='${student}';
    delete from public.memberships where studio_id='${studio}';delete from public.studios where id='${studio}';
    delete from auth.users where id='${coach}';commit;`);
}
