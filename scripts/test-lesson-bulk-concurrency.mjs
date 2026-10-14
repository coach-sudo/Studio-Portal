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
const coach = "d1000000-0000-4000-8000-000000000001",
  studio = "d2000000-0000-4000-8000-000000000001",
  student = "d3000000-0000-4000-8000-000000000001";
const run = "e2e-bulk-concurrency";
async function contend(holder, racer, label, expectedError) {
  let ready;
  const acquired = new Promise((resolve) => {
    ready = resolve;
  });
  const a = session(
    "begin;set local lock_timeout='8s';set local statement_timeout='25s';set application_name='bulk-holder';" +
      holder +
      ";select 'held';select pg_sleep(2);commit;",
    (out) => {
      if (out.includes("held")) ready();
    },
  );
  await Promise.race([
    acquired,
    a.then(() => {
      throw new Error("Holder exited early");
    }),
  ]);
  const b = session(
    "begin;set local lock_timeout='8s';set local statement_timeout='25s';set application_name='bulk-racer';" +
      racer +
      ";commit;",
  ).then(
    (out) => ({ out }),
    (error) => ({ error }),
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(
    query(
      "select count(*) from pg_stat_activity where application_name='bulk-racer' and wait_event_type='Lock';",
    ),
    "1",
    label + " must exercise real lock contention",
  );
  await a;
  const result = await b;
  if (expectedError) assert.match(String(result.error), expectedError);
  else if (result.error) throw result.error;
  console.log(
    label + " passed with observed separate-session lock contention.",
  );
}
function fixture(n) {
  const id = `d6000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  query(
    `insert into lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider) values('${id}','${studio}','${student}','${run} Lesson ${n}',now()+interval '${n * 2} days',now()+interval '${n * 2} days 1 hour','scheduled','in_person','Studio','studio');`,
  );
  const r = JSON.parse(
    query(
      `select preview_lesson_bulk('${coach}','${studio}','preview-bulk-${n}',jsonb_build_object('operation','delete','selectedIds',array['${id}'::uuid],'reason','Erroneous synthetic record'));`,
    ),
  );
  query(
    `select execute_lesson_bulk('${coach}','${r.jobId}','${r.reviewToken}','execute-bulk-${n}');`,
  );
  const c = JSON.parse(
    query(`select claim_lesson_bulk_items(1,'${r.jobId}');`),
  )[0];
  return {
    id,
    review: r,
    claim: c,
    process: `select process_lesson_bulk_item('${c.id}','${c.claim_token}')`,
  };
}
try {
  query(
    `begin;insert into auth.users(id,email) values('${coach}','e2e-bulk-concurrency@example.test');insert into studios(id,name,slug) values('${studio}','Bulk concurrency','${run}');insert into memberships(studio_id,user_id,role,display_name) values('${studio}','${coach}','coach','Bulk coach');insert into students(id,studio_id,full_name) values('${student}','${studio}','${run} Student');commit;`,
  );
  const fk = fixture(1);
  await contend(
    `select id from lessons where id='${fk.id}' for update;insert into notes(lesson_id,student_id,title,body) values('${fk.id}','${student}','Late note','Preserve')`,
    fk.process,
    "Late FK dependency versus deletion",
  );
  assert.equal(
    query(
      `select status from lesson_ops.lesson_bulk_items where id='${fk.claim.id}';`,
    ),
    "conflicted",
  );
  assert.equal(
    query(`select count(*) from notes where lesson_id='${fk.id}';`),
    "1",
  );
  const json = fixture(2);
  await contend(
    `insert into integration_imports(studio_id,provider,external_id,detected_source,payload) values('${studio}','google_calendar','bulk-json-race','studio','{"lessonId":"${json.id}"}')`,
    json.process,
    "Non-FK JSON writer versus deletion",
  );
  assert.equal(
    query(
      `select status from lesson_ops.lesson_bulk_items where id='${json.claim.id}';`,
    ),
    "conflicted",
  );
  const deleted = fixture(3);
  await contend(
    deleted.process,
    `insert into integration_imports(studio_id,provider,external_id,detected_source,payload) values('${studio}','google_calendar','bulk-deleted-json','studio','{"lessonId":"${deleted.id}"}')`,
    "Deletion versus delayed non-FK writer",
    /permanently deleted/,
  );
  assert.equal(
    query(`select count(*) from lessons where id='${deleted.id}';`),
    "0",
  );
  assert.equal(
    query(
      `select count(*) from lesson_ops.lesson_deletion_snapshots where lesson_id='${deleted.id}';`,
    ),
    "1",
  );
  const replay = fixture(4);
  await contend(replay.process, replay.process, "Overlapping bulk item replay");
  assert.equal(
    query(
      `select count(*) from audit_events where entity_id='${replay.id}' and action='lesson.bulk_delete';`,
    ),
    "1",
  );
  const changed = fixture(5);
  await contend(
    `select id from lessons where id='${changed.id}' for update;update lessons set version=version+1 where id='${changed.id}'`,
    changed.process,
    "Concurrent lesson update versus frozen review",
  );
  assert.equal(
    query(
      `select status from lesson_ops.lesson_bulk_items where id='${changed.claim.id}';`,
    ),
    "conflicted",
  );
} finally {
  query(
    `begin;select cleanup_lesson_bulk_fixture('${run}','${studio}');delete from integration_imports where studio_id='${studio}';delete from notes where student_id='${student}';delete from calendar_projections where lesson_id in(select id from lessons where studio_id='${studio}');delete from lessons where studio_id='${studio}';delete from audit_events where studio_id='${studio}';delete from student_credit_accounts where student_id='${student}';delete from students where id='${student}';delete from memberships where studio_id='${studio}';delete from studios where id='${studio}';delete from auth.users where id='${coach}';commit;`,
  );
}
