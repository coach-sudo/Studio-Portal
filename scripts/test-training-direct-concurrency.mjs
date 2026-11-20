// Direct checkout races on a local disposable Supabase database.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import console from "node:console";
import process from "node:process";

const executable = process.platform === "win32" ? "wsl" : "docker";
const prefix = process.platform === "win32" ? ["--exec", "docker"] : [];
const container = process.argv[2] ?? "supabase_db_studio-portal";
assert.match(
  container,
  /^supabase_db_(?:studio-portal|coachd-pr109-direct-acceptance)$/,
);
const args = [
  ...prefix,
  "exec",
  "-i",
  container,
  "psql",
  "-X",
  "-qAt",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-v",
  "ON_ERROR_STOP=1",
];
const sql = (input) =>
  execFileSync(executable, args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 15000,
  }).trim();
const id = (n) => "f1090001-0000-4000-8000-" + String(n).padStart(12, "0");
const actor = id(1),
  studio = id(2),
  student = id(3),
  service = id(4),
  pkg = id(5);
assert.equal(
  sql(`select count(*) from public.studios where id='${studio}';`),
  "0",
);

function run(input, ready) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args);
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
      if (ready && stdout.includes("first-operation-locked")) {
        ready();
        ready = undefined;
      }
    });
    child.stderr.on("data", (data) => (stderr += data));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function race(first, second, error) {
  let competitor;
  const winner = await run(
    "begin; set local statement_timeout='8s';" +
      first +
      "select 'first-operation-locked'; select pg_sleep(1); commit;",
    () => {
      competitor = run("set statement_timeout='8s';" + second);
    },
  );
  assert.equal(winner.code, 0, winner.stderr);
  assert(competitor, "leader query did not acquire its lock");
  const loser = await competitor;
  if (error) {
    assert.notEqual(loser.code, 0);
    assert.match(loser.stderr, error);
  } else assert.equal(loser.code, 0, loser.stderr);
}

const payload = (attempt, lesson) =>
  sql(`
  select jsonb_build_object('id','${id(attempt)}','actor','${actor}','studentId','${student}',
   'items',jsonb_build_array(jsonb_build_object('studentId','${student}','lessonId','${id(lesson)}',
     'amountMinor',8000,'currency','USD','terms',q->>'terms')))
  from training_internal.direct_lesson_quote('${actor}','${id(lesson)}',null) q;`);
const direct = (value) =>
  `select public.training_lesson_checkout('reserve_direct','${value}'::jsonb)->>'id';`;
const cancel = (attempt) =>
  sql(`select public.training_lesson_checkout('cancel_unstarted',
  '{"id":"${id(attempt)}","actor":"${actor}"}')->>'status';`);
const credit = (
  lesson,
) => `select public.command_apply_lesson_credit('${id(lesson)}','${pkg}',
  'Synthetic coverage','pr109-race-credit-${lesson}')->>'packageId';`;
const invoice = (lesson) => `
  select public.save_studio_invoice(jsonb_build_object(
    'student_id','${student}','studio_id','${studio}','status','open','currency','USD',
    'issue_date',current_date,'due_date',current_date+5,'branding','{}'::jsonb,'recipient','{}'::jsonb,
    'introduction','','notes','','footer','','items',jsonb_build_array(jsonb_build_object(
      'id','${id(lesson + 100)}','kind','service','referenceId','${service}','description','Race lesson',
      'quantity',1,'unitMinor',8000,'lessonIds',jsonb_build_array('${id(lesson)}'),'paidMinor',0,'creditMinor',0))),
    'pr109-race-invoice-${lesson}',0)->>'id';`;

sql(`begin;
insert into auth.users(id,email) values('${actor}','pr109-race@example.test');
insert into public.studios(id,name,slug,settings) values('${studio}','Race fixture','pr109-race','{"currency":"USD"}');
insert into public.students(id,studio_id,user_id,full_name,email,portal_enabled) values('${student}','${studio}','${actor}','Race payer','pr109-race@example.test',true);
insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor)
 values('${service}','${studio}','pr109-race','Race service','private',60,8000);
insert into public.packages(id,student_id,name) values('${pkg}','${student}','Race package');
insert into public.package_credit_entries(package_id,kind,quantity,reason) values('${pkg}','purchase',2,'Race fixture');
insert into public.lessons(id,studio_id,student_id,service_id,topic,starts_at,ends_at,status,location_type,location_label,price_minor,payment_status,source_provider)
 values ${[11, 12, 13, 14, 15, 16].map((n) => `('${id(n)}','${studio}','${student}','${service}','Race lesson',now()+interval '${n} days',now()+interval '${n} days 1 hour','scheduled','virtual','Online',8000,'due','studio')`).join(",")};
commit;`);
try {
  await race(
    direct(payload(21, 11)),
    direct(payload(22, 11)),
    /VERSION_CONFLICT/,
  );
  assert.equal(cancel(21), "expired");
  await race(direct(payload(23, 12)), credit(12), /CREDIT_UNAVAILABLE/);
  assert.equal(cancel(23), "expired");
  await race(credit(13), direct(payload(24, 13)), /VERSION_CONFLICT/);
  await race(direct(payload(25, 14)), invoice(14), /already pending/);
  assert.equal(cancel(25), "expired");
  await race(invoice(15), direct(payload(26, 15)), /VERSION_CONFLICT/);
  sql(direct(payload(27, 16)));
  sql(
    `select public.training_lesson_checkout('begin_direct_provider','{"id":"${id(27)}","actor":"${actor}"}');`,
  );
  const settle = `select public.training_lesson_checkout('settle','{"id":"${id(27)}","session":"cs_test_direct_race","intent":"pi_direct_race","amountMinor":8000,"currency":"usd"}')->>'status';`;
  await race(settle, settle);
  assert.equal(
    sql(
      `select count(*) from public.payment_entries where student_id='${student}';`,
    ),
    "1",
  );
  console.log(
    "Passed six separate-session races for checkout, credits, invoices, and provider replay.",
  );
} finally {
  sql(`begin;
    update public.lessons set direct_checkout_id=null,invoice_payment_pending=false,invoice_id=null,package_id=null where student_id='${student}';
    delete from training_internal.lesson_checkouts where studio_id='${studio}';
    delete from public.studio_invoices where studio_id='${studio}';
    delete from public.package_credit_entries where package_id='${pkg}';
    delete from public.packages where id='${pkg}';
    delete from credit_internal.credit_coverage_jobs where student_id='${student}';
    delete from public.student_credit_accounts where student_id='${student}';
    delete from public.audit_events where studio_id='${studio}';
    delete from public.payment_entries where student_id='${student}';
    delete from public.studios where id='${studio}';
    delete from auth.users where id='${actor}';
    commit;`);
}
