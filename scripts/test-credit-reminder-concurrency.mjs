import console from "node:console";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";

const container = execFileSync(
  "docker",
  ["ps", "--filter", "name=^supabase_db_studio-portal$", "--format", "{{.ID}}"],
  { encoding: "utf8" },
).trim();
assert.match(
  container,
  /^[a-f0-9]{12,64}$/,
  "Require one isolated local Studio Portal database",
);
const args = [
  "exec",
  "-i",
  container,
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
const query = (statement) =>
  execFileSync("docker", args, { input: statement, encoding: "utf8" }).trim();
const scope = "md5('reminder-contention-studio')::uuid";
const condition = "md5('reminder-contention-condition')::uuid";
const student = "md5('reminder-contention-student')::uuid";
const recipient = "md5('reminder-contention-recipient')::uuid";
assert.equal(
  query(`select count(*) from public.studios where id=${scope};`),
  "0",
);

function session(statement, observe = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args);
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      observe(output);
    });
    child.stderr.on("data", (chunk) => {
      error += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (status) =>
      status === 0 ? resolve(output) : reject(new Error(error)),
    );
    child.stdin.end(statement);
  });
}
try {
  query(`begin;
    insert into public.studios(id,name,slug) values(${scope},'Reminder contention fixture','reminder-contention-fixture');
    insert into public.students(id,studio_id,full_name) values(${student},${scope},'Reminder contention student');
    insert into credit_internal.reminder_conditions(id,studio_id,student_id,lesson_id,condition_type,
      status,status_reason,opened_at,evaluated_at,next_due_at)
      values(${condition},${scope},${student},${condition},'uncovered_lesson','open','uncovered',now(),now(),now());
    insert into credit_internal.reminder_deliveries(condition_id,cycle_at,student_id,recipient_user_id,channel,
      template_kind,template_version,subject,body,action_path,status,due_at)
      values(${condition},now(),${student},${recipient},'email','uncovered_lesson',0,
        'Synthetic','Synthetic','/portal/credits','queued',now());
    commit;`);
  let signal;
  const held = new Promise((resolve) => {
    signal = resolve;
  });
  const holder = session(
    "begin;set local role service_role;select public.claim_credit_reminder_email(1);select 'claim-held';select pg_sleep(2);commit;",
    (output) => {
      if (output.includes("claim-held")) signal();
    },
  );
  await Promise.race([
    held,
    holder.then(() => {
      throw new Error("Reminder claim never reached its hold");
    }),
  ]);
  const follower = await session(
    "begin;set local role service_role;set local statement_timeout='1s';select public.claim_credit_reminder_email(1);commit;",
  );
  assert.equal(
    follower.trim(),
    "[]",
    "A competing worker skips the locked delivery",
  );
  const claim = JSON.parse((await holder).split("\n")[0]);
  assert.equal(claim.length, 1);
  assert.equal(
    query(
      `select count(*) from credit_internal.reminder_deliveries where condition_id=${condition} and status='claimed';`,
    ),
    "1",
  );
  console.log("Concurrent reminder workers claimed one delivery exactly once.");
} finally {
  query(`begin;
    delete from credit_internal.reminder_deliveries where condition_id=${condition};
    delete from credit_internal.reminder_conditions where id=${condition};
    delete from public.students where id=${student};
    delete from public.studios where id=${scope};
    commit;`);
}
