// Synthetic identities in the named disposable container only. No remote URL.
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
const studio = "e8410000-0000-4000-8000-000000000001",
  actor = "e8410000-0000-4000-8000-000000000002",
  scan = "e8410000-0000-4000-8000-000000000003",
  candidate = "e8410000-0000-4000-8000-000000000004";
assert.equal(
  sql(`select count(*) from public.studios where id='${studio}'`),
  "0",
);
sql(`begin;
insert into auth.users(id,email) values('${actor}','e2e-historical-review-concurrency@example.test');
insert into public.studios(id,name,slug) values('${studio}','e2e-historical-review-concurrency','e2e-historical-review-concurrency');
insert into public.memberships(studio_id,user_id,role,display_name) values('${studio}','${actor}','coach','E2E coach');
insert into discovery_internal.scans(id,studio_id,actor_id,request_key,request_hash,range_start,range_end,timezone) values('${scan}','${studio}','${actor}','e2e-historical-review-scan',repeat('a',64),'2020-01-01','2020-02-01','UTC');
insert into discovery_internal.sources(scan_id,calendar_id,label) values('${scan}','canonical-a','E2E calendar');
insert into discovery_internal.candidates(id,scan_id,calendar_id,event_id,source_key,summary,status,starts_at,ends_at,reason_code) values('${candidate}','${scan}','canonical-a','e2e-historical-review-event',jsonb_build_array('canonical-a','e2e-historical-review-event')::text,'E2E historical review','active','2020-01-01T15:00Z','2020-01-01T16:00Z','event_detected');
commit;`);
const authenticated = `begin;set local role authenticated;set local request.jwt.claim.sub='${actor}';`;
function session(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
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
  throw Error(`No observed PostgreSQL contention for ${application}`);
}
const preview = () =>
  JSON.parse(
    sql(
      authenticated +
        `select public.preview_historical_calendar_review('${candidate}');commit;`,
    ),
  );
// Values below are wholly generated synthetic JSON; SQL literal quoting is
// explicit, not shell interpolation. No provider or user content is accepted.
const literal = (value) =>
  "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
const command = (value, key) =>
  `select public.command_historical_calendar_review('${candidate}',${literal(value)},'${key}');`;
try {
  const value = {
    stamp: preview().stamp,
    action: "skip",
    reason: "Explicit synthetic decision",
  };
  const first = session(
    authenticated +
      `set local application_name='e2e-review-first';` +
      command(value, "e2e-review-concurrent") +
      "select pg_sleep(3);commit;",
  );
  await observed("e2e-review-first", "wait_event='PgSleep'");
  const second = session(
    authenticated +
      `set local application_name='e2e-review-second';` +
      command(value, "e2e-review-concurrent") +
      "commit;",
  );
  await observed("e2e-review-second", "wait_event_type='Lock'");
  const outcomes = await Promise.all([first, second]);
  for (const outcome of outcomes)
    assert.equal(outcome.status, 0, outcome.stderr);
  const result = (outcome) =>
    JSON.parse(outcome.stdout.split("\n").find((line) => line.startsWith("{")));
  assert.deepEqual(result(outcomes[0]), result(outcomes[1]));
  assert.equal(
    sql(
      `select count(*) from discovery_internal.review_receipts where actor_id='${actor}'`,
    ),
    "1",
  );
  assert.equal(
    sql(
      `select count(*) from discovery_internal.decision_revisions where actor_id='${actor}'`,
    ),
    "1",
  );
  const changed = await session(
    authenticated +
      command(
        { ...value, reason: "Changed synthetic request" },
        "e2e-review-concurrent",
      ) +
      "commit;",
  );
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /IDEMPOTENCY_CONFLICT/);
  const next = {
    stamp: preview().stamp,
    action: "not_lesson",
    reason: "Explicit synthetic second review",
  };
  const nextFirst = session(
    authenticated +
      `set local application_name='e2e-review-new-first';` +
      command(next, "e2e-review-next-key") +
      "select pg_sleep(3);commit;",
  );
  await observed("e2e-review-new-first", "wait_event='PgSleep'");
  const nextSecond = session(
    authenticated +
      `set local application_name='e2e-review-new-second';` +
      command(next, "e2e-review-stale-key") +
      "commit;",
  );
  await observed("e2e-review-new-second", "wait_event_type='Lock'");
  const [committed, stale] = await Promise.all([nextFirst, nextSecond]);
  assert.equal(committed.status, 0, committed.stderr);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /VERSION_CONFLICT/);
  assert.equal(
    sql(
      `select count(*) from discovery_internal.decision_revisions where actor_id='${actor}'`,
    ),
    "2",
  );
  assert.equal(
    sql(`select count(*) from public.audit_events where studio_id='${studio}'`),
    "2",
  );
  assert.equal(
    sql(`select count(*) from public.lessons where studio_id='${studio}'`),
    "0",
  );
  assert.equal(
    sql(
      `select count(*) from public.outbox_messages where studio_id='${studio}'`,
    ),
    "0",
  );
  console.log(
    "PASS: observed concurrent identical commands share one receipt/revision/audit; changed payload conflicts; concurrent different keys reject a stale preview; no lesson or notification effect.",
  );
  const student = "e8410000-0000-4000-8000-000000000005",
    secondCandidate = "e8410000-0000-4000-8000-000000000007",
    lateCandidate = "e8410000-0000-4000-8000-000000000008";
  sql(`insert into public.students(id,studio_id,full_name,status) values('${student}','${studio}','e2e-historical-canonical-learner','active');
insert into discovery_internal.candidates(id,scan_id,calendar_id,event_id,source_key,summary,status,starts_at,ends_at,reason_code) values
('${secondCandidate}','${scan}','canonical-a','e2e-canonical-second',jsonb_build_array('canonical-a','e2e-canonical-second')::text,'E2E second source','active','2020-01-02T15:00Z','2020-01-02T16:00Z','event_detected'),
('${lateCandidate}','${scan}','canonical-a','e2e-canonical-late',jsonb_build_array('canonical-a','e2e-canonical-late')::text,'E2E late source','active','2020-01-03T15:00Z','2020-01-03T16:00Z','event_detected');`);
  const reopen = {
    stamp: preview().stamp,
    action: "reopen",
    reason: "Explicit synthetic canonical reopening",
  };
  sql(
    authenticated +
      command(reopen, "e2e-canonical-explicit-reopen") +
      "commit;",
  );
  const createValue = (day) => ({
    action: "create",
    studentId: student,
    reason: "Explicit synthetic historical creation",
    startsAt: day + "T15:00:00Z",
    endsAt: day + "T16:00:00Z",
    timezone: "UTC",
    topic: "e2e-historical-canonical-record",
    locationType: "in_person",
    locationLabel: "E2E studio",
  });
  const canonicalPreview = (id, value) =>
    JSON.parse(
      sql(
        authenticated +
          `select public.preview_historical_calendar_reconciliation('${id}',${literal(value)});commit;`,
      ),
    );
  const canonicalCommand = (id, value, stamp, key) =>
    `select public.command_historical_calendar_reconciliation('${id}',${literal(value)},'${stamp}','${key}');`;
  const firstValue = createValue("2020-01-01"),
    firstStamp = canonicalPreview(candidate, firstValue).stamp;
  const canonicalFirst = session(
    authenticated +
      `set local application_name='e2e-canonical-first';` +
      canonicalCommand(
        candidate,
        firstValue,
        firstStamp,
        "e2e-canonical-same-key",
      ) +
      "select pg_sleep(5);commit;",
  );
  await observed("e2e-canonical-first", "wait_event='PgSleep'");
  const canonicalSecond = session(
    authenticated +
      `set local application_name='e2e-canonical-second';` +
      canonicalCommand(
        candidate,
        firstValue,
        firstStamp,
        "e2e-canonical-same-key",
      ) +
      "commit;",
  );
  await observed("e2e-canonical-second", "wait_event_type='Lock'");
  const legacyInsert = (event, id) =>
    `insert into public.integration_imports(id,studio_id,provider,external_id,detected_source,status,payload) values('${id}','${studio}','google_calendar','${event}','google_calendar','needs_review','{}');`;
  const oldWorker = session(
    `begin;set local role service_role;set local application_name='e2e-canonical-old-worker';` +
      legacyInsert(
        "e2e-historical-review-event",
        "e8410000-0000-4000-8000-000000000041",
      ) +
      "commit;",
  );
  await observed("e2e-canonical-old-worker", "wait_event_type='Lock'");
  const [canonOne, canonTwo, old] = await Promise.all([
    canonicalFirst,
    canonicalSecond,
    oldWorker,
  ]);
  assert.equal(canonOne.status, 0, canonOne.stderr);
  assert.equal(canonTwo.status, 0, canonTwo.stderr);
  assert.deepEqual(result(canonOne), result(canonTwo));
  assert.notEqual(old.status, 0);
  assert.match(old.stderr, /historical reconciliation command/);
  assert.equal(
    sql(`select count(*) from public.lessons where studio_id='${studio}'`),
    "1",
  );
  assert.equal(
    sql(
      `select count(*) from public.integration_imports where studio_id='${studio}' and external_id='e2e-historical-review-event'`,
    ),
    "0",
  );
  const changedCanonical = await session(
    authenticated +
      canonicalCommand(
        candidate,
        { ...firstValue, reason: "Changed canonical request" },
        firstStamp,
        "e2e-canonical-same-key",
      ) +
      "commit;",
  );
  assert.notEqual(changedCanonical.status, 0);
  assert.match(changedCanonical.stderr, /IDEMPOTENCY_CONFLICT/);
  const secondValue = createValue("2020-01-02"),
    secondStamp = canonicalPreview(secondCandidate, secondValue).stamp;
  const differentFirst = session(
    authenticated +
      `set local application_name='e2e-canonical-new-first';` +
      canonicalCommand(
        secondCandidate,
        secondValue,
        secondStamp,
        "e2e-canonical-new-key-one",
      ) +
      "select pg_sleep(3);commit;",
  );
  await observed("e2e-canonical-new-first", "wait_event='PgSleep'");
  const differentSecond = session(
    authenticated +
      `set local application_name='e2e-canonical-new-second';` +
      canonicalCommand(
        secondCandidate,
        secondValue,
        secondStamp,
        "e2e-canonical-new-key-two",
      ) +
      "commit;",
  );
  await observed("e2e-canonical-new-second", "wait_event_type='Lock'");
  const [differentWon, differentHeld] = await Promise.all([
    differentFirst,
    differentSecond,
  ]);
  assert.equal(differentWon.status, 0, differentWon.stderr);
  assert.notEqual(differentHeld.status, 0);
  assert.match(differentHeld.stderr, /VERSION_CONFLICT/);
  const lateValue = createValue("2020-01-03"),
    lateStamp = canonicalPreview(lateCandidate, lateValue).stamp;
  const rawFirst = session(
    `begin;set local role service_role;set local application_name='e2e-canonical-import-first';` +
      legacyInsert(
        "e2e-canonical-late",
        "e8410000-0000-4000-8000-000000000042",
      ) +
      "select pg_sleep(3);commit;",
  );
  await observed("e2e-canonical-import-first", "wait_event='PgSleep'");
  const canonicalLate = session(
    authenticated +
      `set local application_name='e2e-canonical-after-import';` +
      canonicalCommand(
        lateCandidate,
        lateValue,
        lateStamp,
        "e2e-canonical-after-import-key",
      ) +
      "commit;",
  );
  await observed("e2e-canonical-after-import", "wait_event_type='Lock'");
  const [rawCommitted, lateHeld] = await Promise.all([rawFirst, canonicalLate]);
  assert.equal(rawCommitted.status, 0, rawCommitted.stderr);
  assert.notEqual(lateHeld.status, 0);
  assert.match(lateHeld.stderr, /VERSION_CONFLICT/);
  assert.equal(
    sql(`select count(*) from public.lessons where studio_id='${studio}'`),
    "2",
  );
  assert.equal(
    sql(
      `select count(*) from public.lesson_participants p join public.lessons l on l.id=p.lesson_id where l.studio_id='${studio}' and p.status='confirmed'`,
    ),
    "2",
  );
  assert.equal(
    sql(
      `select count(*) from public.lessons where studio_id='${studio}' and (status<>'scheduled' or payment_status<>'untracked' or paid_minor<>0 or price_minor<>0)`,
    ),
    "0",
  );
  assert.equal(
    sql(
      `select count(*) from public.payment_entries where student_id='${student}'`,
    ),
    "0",
  );
  assert.equal(
    sql(
      `select count(*) from public.outbox_messages where studio_id='${studio}'`,
    ),
    "0",
  );
  assert.equal(
    sql(
      `select count(*) from public.calendar_projections p join public.lessons l on l.id=p.lesson_id where l.studio_id='${studio}'`,
    ),
    "0",
  );
  console.log(
    "PASS: observed canonical same-key replay commits one lesson/participant; changed payload conflicts; different keys reject stale creation; both legacy-import race orderings are safe; no attendance, payment, notification or Calendar effect.",
  );
} finally {
  assert.equal(
    sql(
      `select count(*) from discovery_internal.scans where studio_id='${studio}' and request_key<>'e2e-historical-review-scan'`,
    ),
    "0",
    "Cleanup ownership fence",
  );
  sql(`begin;
delete from discovery_internal.review_receipts where actor_id='${actor}' and studio_id='${studio}';
delete from discovery_internal.decision_revisions where actor_id='${actor}';
delete from discovery_internal.source_observations where decision_id in(select id from discovery_internal.source_decisions where studio_id='${studio}');
delete from discovery_internal.source_decisions where studio_id='${studio}';
delete from discovery_internal.candidates where scan_id='${scan}';
delete from discovery_internal.sources where scan_id='${scan}';
delete from discovery_internal.scans where id='${scan}' and studio_id='${studio}';
delete from public.integration_imports where studio_id='${studio}';
delete from public.lesson_participants where lesson_id in(select id from public.lessons where studio_id='${studio}');
delete from public.lessons where studio_id='${studio}';
delete from credit_internal.credit_coverage_jobs where student_id in(select id from public.students where studio_id='${studio}');
delete from public.students where studio_id='${studio}';
delete from public.audit_events where studio_id='${studio}';
delete from public.memberships where studio_id='${studio}';
delete from public.studios where id='${studio}';
delete from auth.users where id='${actor}';
commit;`);
  assert.equal(
    sql(`select count(*) from public.studios where id='${studio}'`),
    "0",
  );
}
