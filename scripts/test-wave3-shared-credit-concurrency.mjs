import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

// The target is a dedicated local Supabase stack. No connection URL is accepted.
const container =
  process.argv[2] === "--cleanup"
    ? "supabase_db_coachd-pr109-direct-acceptance"
    : (process.argv[2] ?? "supabase_db_coachd-pr109-direct-acceptance");
assert.match(
  container,
  /^supabase_db_(?:studio-portal|coachd-pr109-direct-acceptance)$/,
);
const binary = process.platform === "win32" ? "wsl" : "docker";
const args = [
  ...(process.platform === "win32" ? ["--exec", "docker"] : []),
  "exec",
  "-i",
  container,
  "psql",
  "-X",
  "-qAt",
  "-U",
  "postgres",
  "-v",
  "ON_ERROR_STOP=1",
];
const run = (sql) =>
  execFileSync(binary, args, {
    input: sql,
    encoding: "utf8",
    timeout: 15_000,
  }).trim();
const session = (sql) =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let error = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      error += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code ? reject(new Error(error)) : resolve(output.trim()),
    );
    child.stdin.end(sql);
  });
const id = (n) => "f3110000-0000-4000-8000-" + String(n).padStart(12, "0");
function cleanup() {
  run(
    "begin;delete from public.package_credit_entries where package_id in ('" +
      id(22) +
      "','" +
      id(23) +
      "');delete from public.lessons where studio_id='" +
      id(10) +
      "';delete from public.packages where student_id='" +
      id(11) +
      "';delete from credit_internal.credit_command_receipts where student_id='" +
      id(11) +
      "';delete from credit_internal.credit_coverage_jobs where student_id='" +
      id(11) +
      "';delete from public.student_credit_accounts where student_id='" +
      id(11) +
      "';delete from public.studios where id='" +
      id(10) +
      "';delete from auth.users where id in (" +
      [1, 2, 3, 4].map((i) => "'" + id(i) + "'").join(",") +
      ");commit;",
  );
}
if (process.argv[2] === "--cleanup") {
  cleanup();
  process.exit(0);
}
const fixture = readFileSync(
  "supabase/tests/wave3_shared_coverage.sql",
  "utf8",
);
const testStart = "select throws_ok";
assert.ok(fixture.includes(testStart));
assert.equal(
  run("select count(*) from public.studios where id='" + id(10) + "'"),
  "0",
);
run(
  fixture.split(testStart)[0] +
    "select pg_temp.share(22,array[12,13],array[]::uuid[],1,'w3-concurrency-roster');commit;",
);
const jobs = [];
const waitFor = async (sql) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (run(sql) === "t") return;
    await delay(100);
  }
  throw new Error("Expected overlapping sessions were not observed");
};
try {
  const first = session(
    "set application_name='w3-sibling-one';begin;select public.reserve_student_lesson_credit('" +
      id(31) +
      "','" +
      id(12) +
      "',null,true);select pg_sleep(5);commit;",
  );
  jobs.push(first);
  await waitFor(
    "select exists(select 1 from pg_stat_activity where application_name='w3-sibling-one' and wait_event='PgSleep')",
  );
  const second = session(
    "set application_name='w3-sibling-two'; select coalesce(public.reserve_student_lesson_credit('" +
      id(32) +
      "','" +
      id(13) +
      "',null,true)::text,'no credit');",
  );
  jobs.push(second);
  await waitFor(
    "select exists(select 1 from pg_stat_activity where application_name='w3-sibling-two' and cardinality(pg_blocking_pids(pid))>0)",
  );
  const [left, right] = await Promise.all(jobs);
  assert.equal(left, id(22));
  assert.equal(right, "no credit");
  assert.equal(
    run("select public.package_credit_balance('" + id(22) + "')"),
    "0",
  );
  assert.equal(
    run(
      "select count(*) from public.package_credit_entries where package_id='" +
        id(22) +
        "' and quantity<0",
    ),
    "1",
  );
  console.log(
    "Shared final credit: two overlapping sibling transactions, one reservation and one denial.",
  );
} finally {
  await Promise.allSettled(jobs);
  cleanup();
}
