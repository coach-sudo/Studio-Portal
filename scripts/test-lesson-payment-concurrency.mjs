// Real PostgreSQL in the named disposable local stack only. No URL/credential input.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import process from "node:process";
import console from "node:console";
import { setTimeout } from "node:timers";
assert.equal(process.argv.length, 2);
const binary = process.platform === "win32" ? "wsl" : "docker";
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
  execFileSync(binary, args, {
    input,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
assert.match(sql("select version()"), /PostgreSQL 17\./);
const studio = "e2940000-0000-4000-8000-000000000010",
  actor = "e2940000-0000-4000-8000-000000000001",
  student = "e2940000-0000-4000-8000-000000000002",
  lesson = "e2940000-0000-4000-8000-000000000003";
assert.equal(
  sql(`select count(*) from public.studios where id='${studio}'`),
  "0",
  "Never reuse an existing studio",
);
const role = `set local role authenticated;set local request.jwt.claim.sub='${actor}';`;
const literal = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const prepare = () => {
  const c = JSON.parse(
    sql(
      `begin;${role}select public.lesson_payment_context('${lesson}');commit;`,
    ),
  );
  return {
    lessonId: lesson,
    version: c.version,
    reviewToken: c.reviewToken,
    amountMinor: 1000,
    currency: c.currency,
    method: "cash",
    reason: "Synthetic concurrent money received",
  };
};
const command = (request, key) =>
  `select public.record_lesson_payment(${literal(request)},'${key}');`;
function session(name, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let out = "",
      error = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (error += c));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, out: out.trim(), error }));
    child.stdin.end(`set application_name='${name}';${input}`);
  });
}
async function sleeping(name) {
  const limit = Date.now() + 10000;
  while (Date.now() < limit) {
    if (
      sql(
        `select count(*) from pg_stat_activity where application_name='${name}' and wait_event='PgSleep'`,
      ) === "1"
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw Error(
    "Did not observe the first transaction holding its committed-within-transaction receipt",
  );
}
sql(
  `begin;insert into auth.users(id,email) values('${actor}','e2e-payment-race-coach@example.test');insert into public.studios(id,name,slug,settings) values('${studio}','E2E payment race','e2e-payment-race','{"currency":"USD"}');insert into public.memberships(studio_id,user_id,role,display_name) values('${studio}','${actor}','coach','Synthetic payment coach');insert into public.students(id,studio_id,full_name) values('${student}','${studio}','Original synthetic race student');insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,price_minor,paid_minor,payment_status) values('${lesson}','${studio}','${student}','Synthetic payment race','2031-01-20T15:00:00Z','2031-01-20T16:00:00Z','scheduled','in_person','Synthetic location',6000,0,'due');commit;`,
);
try {
  const initial = prepare();
  const first = session(
    "e2e-payment-same-a",
    `begin;${role}${command(initial, "e2e-payment-race-same")}select pg_sleep(1);commit;`,
  );
  await sleeping("e2e-payment-same-a");
  const second = session(
    "e2e-payment-same-b",
    `begin;${role}${command(initial, "e2e-payment-race-same")}commit;`,
  );
  const same = await Promise.all([first, second]);
  assert.ok(
    same.every((r) => r.status === 0),
    JSON.stringify(same),
  );
  assert.equal(
    JSON.parse(same[0].out.split("\n")[0]).receiptId,
    JSON.parse(same[1].out).receiptId,
  );
  assert.equal(
    sql(
      `select count(*) from lesson_ops.payment_receipts where studio_id='${studio}'`,
    ),
    "1",
  );
  const conflict = await session(
    "e2e-payment-changed",
    `begin;${role}${command({ ...initial, amountMinor: 2000 }, "e2e-payment-race-same")}commit;`,
  );
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.error, /IDEMPOTENCY_CONFLICT/);
  const fresh = prepare();
  const a = session(
    "e2e-payment-distinct-a",
    `begin;${role}${command(fresh, "e2e-payment-race-key-a")}select pg_sleep(1);commit;`,
  );
  await sleeping("e2e-payment-distinct-a");
  const b = session(
    "e2e-payment-distinct-b",
    `begin;${role}${command(fresh, "e2e-payment-race-key-b")}commit;`,
  );
  const distinct = await Promise.all([a, b]);
  assert.equal(distinct.filter((r) => r.status === 0).length, 1);
  assert.match(distinct.find((r) => r.status !== 0).error, /VERSION_CONFLICT/);
  assert.equal(
    sql(`select paid_minor from public.lessons where id='${lesson}'`),
    "2000",
  );
  assert.equal(
    sql(
      `select sum(amount_minor) from public.payment_entries where student_id='${student}'`,
    ),
    "2000",
  );
  assert.equal(
    sql(
      `select count(*) from lesson_ops.payment_receipts where studio_id='${studio}'`,
    ),
    "2",
  );
  assert.equal(
    sql(
      `select count(*) from public.outbox_messages where studio_id='${studio}'`,
    ),
    "0",
  );
  sql(
    `delete from public.memberships where studio_id='${studio}' and user_id='${actor}'`,
  );
  const revoked = await session(
    "e2e-payment-revoked",
    `begin;${role}${command(initial, "e2e-payment-race-same")}commit;`,
  );
  assert.notEqual(revoked.status, 0);
  assert.match(revoked.error, /FORBIDDEN/);
  console.log(
    "Actual PostgreSQL payment races passed: observed same-key serialization, immutable replay, changed-payload rejection, one distinct-key winner, exact ledger/lesson totals, revoked coach denial; no notification effect.",
  );
} finally {
  sql(
    `begin;delete from lesson_ops.payment_receipts where studio_id='${studio}';delete from public.payment_entries where student_id='${student}';delete from public.audit_events where studio_id='${studio}';delete from public.lessons where id='${lesson}';delete from credit_internal.credit_coverage_jobs where student_id='${student}';delete from public.student_credit_accounts where student_id='${student}';delete from public.students where id='${student}';delete from public.memberships where studio_id='${studio}';delete from public.studios where id='${studio}';delete from auth.users where id='${actor}';commit;`,
  );
}
