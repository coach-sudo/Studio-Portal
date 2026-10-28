// Named disposable container only. Never accepts a remote URL or credentials.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import process from "node:process";
import console from "node:console";
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
const studio = "e7500000-0000-4000-8000-000000000001",
  student = "e7500000-0000-4000-8000-000000000002",
  service = "e7500000-0000-4000-8000-000000000003",
  booking = "e7500000-0000-4000-8000-000000000004";
assert.equal(
  sql(`select count(*) from public.studios where id='${studio}'`),
  "0",
);
sql(`begin;
insert into public.studios(id,name,slug) values('${studio}','E2E installment concurrency','e2e-installment-concurrency');
insert into public.students(id,studio_id,full_name,email) values('${student}','${studio}','E2E installment concurrency','e2e-installment-concurrency@example.test');
insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor) values('${service}','${studio}','e2e-installment-concurrency','E2E installment concurrency','private',60,300);
insert into public.bookings(id,studio_id,reference,service_id,student_id,guest_name,guest_email,starts_at,ends_at,timezone,location,status,payment_policy,payment_status,total_minor,paid_minor,currency,policy_snapshot,manage_token_hash,stripe_subscription_id,installment_count,installments_paid)
values('${booking}','${studio}','E2E-INSTALLMENT-CONCURRENCY','${service}','${student}','E2E installment concurrency','e2e-installment-concurrency@example.test','2031-11-10T18:00:00Z','2031-11-10T19:00:00Z','UTC','in_person','confirmed','installments','due',300,0,'USD','{}','e2e-installment-concurrency-token','sub_e2e_concurrency',3,0);commit;`);
const command = (invoice, amount = 100) =>
  `select public.settle_stripe_booking_invoice('{"bookingId":"${booking}","invoiceId":"${invoice}","subscriptionId":"sub_e2e_concurrency","amountMinor":${amount},"currency":"USD"}');`;
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
  const same = await Promise.all([
    session(
      "begin;set local role service_role;" +
        command("in_e2e_concurrent_one") +
        "select pg_sleep(0.5);commit;",
    ),
    session(
      "begin;set local role service_role;" +
        command("in_e2e_concurrent_one") +
        "commit;",
    ),
  ]);
  same.forEach((r) => assert.equal(r.status, 0, r.stderr));
  assert.equal(
    sql(
      `select paid_minor||':'||installments_paid from public.bookings where id='${booking}'`,
    ),
    "100:1",
  );
  assert.equal(
    sql(
      `select count(*) from public.payment_entries where student_id='${student}'`,
    ),
    "1",
  );
  const changed = await session(
    "begin;set local role service_role;" +
      command("in_e2e_concurrent_one", 101) +
      "commit;",
  );
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /IDEMPOTENCY_CONFLICT/);
  const distinct = await Promise.all([
    session(
      "begin;set local role service_role;" +
        command("in_e2e_concurrent_two") +
        "select pg_sleep(0.5);commit;",
    ),
    session(
      "begin;set local role service_role;" +
        command("in_e2e_concurrent_three") +
        "commit;",
    ),
  ]);
  distinct.forEach((r) => assert.equal(r.status, 0, r.stderr));
  assert.equal(
    sql(
      `select paid_minor||':'||installments_paid from public.bookings where id='${booking}'`,
    ),
    "300:3",
  );
  assert.equal(
    sql(
      `select count(*) from public.payment_entries where student_id='${student}'`,
    ),
    "3",
  );
  assert.equal(
    sql(
      `select count(*) from workspace_internal.stripe_booking_invoice_receipts where booking_id='${booking}'`,
    ),
    "3",
  );
  assert.equal(
    sql(
      `select count(*) from workspace_internal.stripe_booking_invoice_effects where invoice_id like 'in_e2e_concurrent_%'`,
    ),
    "3",
  );
  console.log(
    "PASS: concurrent same-invoice delivery has one payment/counter/receipt; distinct invoices serialize without lost increments; changed replay is rejected.",
  );
} finally {
  assert.equal(
    sql(
      `select count(*) from public.bookings where id='${booking}' and reference='E2E-INSTALLMENT-CONCURRENCY'`,
    ),
    "1",
    "Cleanup ownership fence",
  );
  sql(`begin;delete from workspace_internal.stripe_booking_invoice_effects where invoice_id in(select invoice_id from workspace_internal.stripe_booking_invoice_receipts where booking_id='${booking}');
delete from workspace_internal.stripe_booking_invoice_receipts where booking_id='${booking}';
delete from public.audit_events where studio_id='${studio}';delete from public.payment_entries where student_id='${student}';delete from public.bookings where id='${booking}';delete from public.booking_services where id='${service}';delete from public.students where id='${student}';delete from public.studios where id='${studio}';commit;`);
  assert.equal(
    sql(`select count(*) from public.studios where id='${studio}'`),
    "0",
  );
}
