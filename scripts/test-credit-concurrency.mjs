// Runs only inside the local Supabase Docker database. No linked/remote target exists.
import assert from "node:assert/strict";
import console from "node:console";
import { setTimeout as delay } from "node:timers/promises";
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
  await delay(250);
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
  query(`update public.student_credit_accounts set auto_apply=false where student_id='${student}';
    select public.command_grant_student_credits('${student}','manual-race-grant','{"quantity":1,"kind":"adjustment","reason":"Manual race fixture"}','${coach}');`);
  const version = query(
    `select version from public.student_credit_accounts where student_id='${student}'`,
  );
  const manual = `select coalesce(public.command_student_credit_settings('${student}','apply_upcoming','{}',${version},'manual-race-intent','${coach}')->>'duplicate','false');`;
  const responses = await Promise.all([session(manual), session(manual)]);
  assert.deepEqual(responses.map((value) => value.trim()).sort(), [
    "false",
    "true",
  ]);
  assert.equal(
    query(
      `select auto_apply from public.student_credit_accounts where student_id='${student}'`,
    ),
    "f",
    "Manual concurrency never enables automatic use",
  );
  assert.equal(
    query(
      `select count(*) from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id='${student}' and e.quantity<0`,
    ),
    "3",
    "One additional lesson debit across both manual requests",
  );
  assert.equal(
    query(
      `select count(*) from public.audit_events where correlation_id='manual-race-intent'`,
    ),
    "1",
    "Manual replay retains one audit",
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

// A single shared lot must serialize different student locks.
const second = "93000000-0000-4000-8000-000000000002";
const family = "93000000-0000-4000-8000-000000000003";
const shared = "93000000-0000-4000-8000-000000000004";
const service = "93000000-0000-4000-8000-000000000005";
const definition = "93000000-0000-4000-8000-000000000006";
const lessonA = "93000000-0000-4000-8000-000000000007";
const lessonB = "93000000-0000-4000-8000-000000000008";

async function raceShared(holderSql, contenderSql) {
  let notify;
  const ready = new Promise((resolve) => {
    notify = resolve;
  });
  const holder = session(
    `begin;select id from public.packages where id='${shared}' for update;
     ${holderSql} select 'shared-lock';select pg_sleep(2);commit;`,
    (output) => {
      if (output.includes("shared-lock")) notify();
    },
  );
  await Promise.race([
    ready,
    holder.then(() => {
      throw new Error("Holder finished before opening the race");
    }),
  ]);
  const contender = session(
    `set application_name='shared-credit-racer';${contenderSql}`,
  );
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const waiting = query(
        "select count(*) from pg_stat_activity where application_name='shared-credit-racer' and wait_event_type='Lock'",
      );
      if (waiting === "1") return await Promise.all([holder, contender]);
      await delay(50);
    }
    throw new Error(
      "Expected the second household session to contend on the pool lock",
    );
  } finally {
    await Promise.allSettled([holder, contender]);
  }
}

try {
  query(`begin;
    insert into auth.users(id,email) values('${coach}','e2e-concurrency-coach@example.test');
    insert into public.studios(id,name,slug) values('${studio}','Shared concurrency','e2e-credit-shared-concurrency');
    insert into public.memberships(studio_id,user_id,role,display_name) values('${studio}','${coach}','coach','Shared coach');
    insert into public.students(id,studio_id,full_name) values('${student}','${studio}','Student 1'),('${second}','${studio}','Student 2');
    insert into credit_internal.credit_households(id,studio_id,name) values('${family}','${studio}','Family');
    insert into credit_internal.credit_household_members(household_id,student_id) values('${family}','${student}'),('${family}','${second}');
    insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes)
      values('${service}','${studio}','shared-race','Shared','private',60);
    insert into public.package_definitions(id,studio_id,name,session_count,session_duration_minutes,price_minor,
      eligible_service_ids,allow_household_credits,allow_credit_transfer)
      values('${definition}','${studio}','Shared',1,60,10000,array['${service}'::uuid],true,true);
    insert into public.packages(id,household_id,definition_id,name)
      values('${shared}','${family}','${definition}','Shared');
    insert into public.package_credit_entries(package_id,kind,quantity,reason) values('${shared}','adjustment',1,'Test grant');
    insert into credit_internal.credit_pool_members(package_id,household_id,student_id)
      values('${shared}','${family}','${student}'),('${shared}','${family}','${second}');
    insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id)
      values('${lessonA}','${studio}','${student}','Student 1 lesson',now()+interval '1 day',now()+interval '25 hours','scheduled','virtual','Meet','${service}'),
        ('${lessonB}','${studio}','${second}','Student 2 lesson',now()+interval '2 days',now()+interval '49 hours','scheduled','virtual','Meet','${service}');
    commit;`);
  const reserve = (lesson, who) =>
    `select coalesce(public.reserve_student_lesson_credit('${lesson}','${who}',null,true)::text,'no_credit');`;
  const [, losingBooking] = await raceShared(
    reserve(lessonA, student),
    reserve(lessonB, second),
  );
  assert.equal(losingBooking.trim(), "no_credit");
  assert.equal(
    query(
      `select count(*) from public.package_credit_entries where package_id='${shared}' and kind='reservation'`,
    ),
    "1",
  );
  query(
    `select public.settle_lesson_credits('${lessonA}',false,'${student}');`,
  );

  const commands = [student, second].map((who, index) => {
    const change = { packageId: shared, studentId: who, quantity: 1 };
    const auth = `set request.jwt.claim.sub='${coach}';`;
    const preview = JSON.parse(
      query(
        auth +
          `select public.household_credit_access('${student}','transfer_preview','${JSON.stringify(change)}')-'status'-'canApply';`,
      ),
    );
    return (
      auth +
      `select public.household_credit_access('${student}','transfer_apply','${JSON.stringify(
        {
          ...change,
          reason: "Concurrent transfer fixture",
          key: "shared-race-" + index,
          preview,
        },
      )}')->>'status';`
    );
  });
  const [winningTransfer, losingTransfer] = await raceShared(
    commands[0],
    commands[1],
  );
  assert.match(winningTransfer, /completed/);
  assert.equal(losingTransfer.trim(), "stale");
  assert.equal(
    query(
      `select count(*) from public.packages where transferred_from_package_id='${shared}'`,
    ),
    "1",
  );
  assert.equal(query(`select public.package_credit_balance('${shared}')`), "0");
  const bulkCommands = [student, second].map((who, index) => {
    const batch = {
      rows: [{ studentId: who, packageId: shared, delta: 1 }],
      reason: "Concurrent shared bulk adjustment",
    };
    const preview = JSON.parse(
      query(`select public.command_student_credit_settings(
      '${who}','bulk_package_preview','${JSON.stringify(batch)}',0,'shared-bulk-preview-${index}','${coach}') -> 'rows';`),
    );
    return `select public.command_student_credit_settings('${who}','bulk_package_apply',
      '${JSON.stringify({ ...batch, preview })}',0,'shared-bulk-apply-${index}','${coach}') ->> 'status';`;
  });
  const [winningBatch, losingBatch] = await raceShared(
    bulkCommands[0],
    bulkCommands[1],
  );
  assert.match(winningBatch, /completed/);
  assert.equal(losingBatch.trim(), "stale");
  assert.equal(query(`select public.package_credit_balance('${shared}')`), "1");
  console.log(
    "Shared pool contention passed for household reservations, transfers and bulk adjustments.",
  );
} finally {
  query(`begin;
    delete from credit_internal.credit_command_receipts where student_id in ('${student}','${second}');
    delete from credit_internal.credit_coverage_jobs where student_id in ('${student}','${second}');
    delete from public.audit_events where studio_id='${studio}';
    delete from credit_internal.credit_pool_members where household_id='${family}';
    delete from public.package_credit_entries where package_id='${shared}' or package_id in
      (select id from public.packages where transferred_from_package_id='${shared}');
    delete from public.lessons where studio_id='${studio}';
    delete from public.packages where transferred_from_package_id='${shared}';
    delete from public.packages where id='${shared}';
    delete from credit_internal.credit_household_members where household_id='${family}';
    delete from credit_internal.credit_households where id='${family}';
    delete from public.student_credit_accounts where student_id in ('${student}','${second}');
    delete from public.students where studio_id='${studio}';
    delete from public.package_definitions where studio_id='${studio}';
    delete from public.booking_services where studio_id='${studio}';
    delete from public.memberships where studio_id='${studio}';
    delete from public.studios where id='${studio}';
    delete from auth.users where id='${coach}';commit;`);
}
