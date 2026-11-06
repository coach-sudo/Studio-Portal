// Named disposable PostgreSQL container only. No remote connection parameters.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import process from "node:process";
import console from "node:console";
const executable = process.platform === "win32" ? "wsl" : "docker",
  prefix = process.platform === "win32" ? ["--exec", "docker"] : [];
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
const actor = "e7700000-0000-4000-8000-000000000001",
  studio = "e7700000-0000-4000-8000-000000000002",
  student = "e7700000-0000-4000-8000-000000000003",
  lesson = "e7700000-0000-4000-8000-000000000004";
assert.equal(
  sql(`select count(*) from public.studios where id='${studio}'`),
  "0",
);
sql(`begin;insert into auth.users(id,email) values('${actor}','e2e-correction-concurrency@example.test');
insert into public.studios(id,name,slug) values('${studio}','E2E correction concurrency','e2e-correction-concurrency');
insert into public.memberships(studio_id,user_id,role,display_name) values('${studio}','${actor}','coach','Synthetic coach');
insert into public.students(id,studio_id,full_name) values('${student}','${studio}','E2E correction concurrency');
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider) values('${lesson}','${studio}','${student}','E2E correction concurrency','2031-11-10T10:00Z','2031-11-10T11:00Z','scheduled','in_person','Synthetic','studio');commit;`);
const authenticate = `begin;set local role authenticated;select set_config('request.jwt.claim.sub','${actor}',true);`;
const value = {
  lessonId: lesson,
  version: 1,
  startsAt: "2020-01-01T10:00:00Z",
  endsAt: "2020-01-01T11:00:00Z",
  timezone: "UTC",
  reason: "Synthetic original time correction",
};
const literal = (v) =>
  "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
value.reviewToken = sql(
  authenticate +
    `select public.preview_lesson_datetime_correction(${literal(value)})->>'reviewToken';rollback;`,
)
  .split(/\r?\n/)
  .at(-1);
const command = (key, body = value) =>
  `select public.correct_lesson_datetime(${literal(body)},'${key}');`;
function session(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}
try {
  const deliveries = await Promise.all([
    session(
      authenticate +
        command("e2e-correction-concurrent-key") +
        "select pg_sleep(0.5);commit;",
    ),
    session(
      authenticate + command("e2e-correction-concurrent-key") + "commit;",
    ),
  ]);
  deliveries.forEach((r) => assert.equal(r.status, 0, r.stderr));
  assert.equal(
    sql(
      `select count(*) from lesson_ops.datetime_corrections where lesson_id='${lesson}'`,
    ),
    "1",
  );
  assert.equal(
    sql(
      `select count(*) from public.audit_events where entity_id='${lesson}' and action='lesson.datetime_corrected'`,
    ),
    "1",
  );
  assert.equal(
    sql(
      `select starts_at='2020-01-01T10:00Z'::timestamptz from public.lessons where id='${lesson}'`,
    ),
    "t",
  );
  const changed = await session(
    authenticate +
      command("e2e-correction-concurrent-key", {
        ...value,
        reason: "A different correction",
      }) +
      "commit;",
  );
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /IDEMPOTENCY_CONFLICT/);
  const stale = await session(
    authenticate + command("e2e-correction-new-stale-key") + "commit;",
  );
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /VERSION_CONFLICT/);
  console.log(
    "PASS: concurrent correction delivery has one date change/audit/receipt; changed replay and stale new request are rejected.",
  );
} finally {
  assert.equal(
    sql(
      `select count(*) from public.lessons where id='${lesson}' and topic='E2E correction concurrency'`,
    ),
    "1",
    "Cleanup ownership fence",
  );
  sql(
    `begin;delete from lesson_ops.datetime_correction_reviews where correction_id in(select id from lesson_ops.datetime_corrections where lesson_id='${lesson}');delete from lesson_ops.datetime_corrections where lesson_id='${lesson}';delete from public.audit_events where studio_id='${studio}';delete from public.lessons where id='${lesson}';delete from public.students where id='${student}';delete from public.memberships where studio_id='${studio}';delete from public.studios where id='${studio}';delete from auth.users where id='${actor}';commit;`,
  );
  assert.equal(
    sql(`select count(*) from public.studios where id='${studio}'`),
    "0",
  );
}
