// Only the named disposable local database is supported; no remote URLs.
import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { execFileSync, spawn } from "node:child_process";
const executable = process.platform === "win32" ? "wsl" : "docker";
const args = [
  ...(process.platform === "win32" ? ["--exec", "docker"] : []),
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
  }).trim();
assert.match(sql("select version()"), /PostgreSQL 17\./);
assert.equal(
  sql("select count(*) from worker_internal.scheduled_jobs"),
  "0",
  "Disposable worker receipts must start empty",
);
const session = (input) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let out = "",
      err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, out: out.trim(), err }));
    child.stdin.end(input);
  });
try {
  const id = sql("select public.enqueue_scheduled_worker('provider-intake')");
  const claim = `select coalesce(public.claim_scheduled_worker('provider-intake','${id}')::text,'unclaimed');`;
  const results = await Promise.all([
    session(`begin;${claim}select pg_sleep(0.3);commit;`),
    session(`begin;${claim}commit;`),
  ]);
  results.forEach((result) => assert.equal(result.status, 0, result.err));
  const tokens = results.map((r) =>
    r.out
      .split("\n")
      .find((line) => line === "unclaimed" || /^[a-f0-9-]{36}$/.test(line)),
  );
  assert.equal(tokens.filter((t) => t === "unclaimed").length, 1);
  assert.equal(tokens.filter((t) => t && t !== "unclaimed").length, 1);
  assert.equal(
    sql("select public.enqueue_scheduled_worker('provider-intake') is null"),
    "t",
  );
  const old = tokens.find((t) => t !== "unclaimed");
  sql(
    "update worker_internal.scheduled_jobs set claim_until=now()-interval '1 second'",
  );
  const next = sql(claim);
  assert.notEqual(next, old);
  assert.equal(
    sql(
      `select public.finish_scheduled_worker('provider-intake','${id}','${old}')`,
    ),
    "f",
  );
  assert.equal(
    sql(
      `select public.finish_scheduled_worker('provider-intake','${id}','${next}','timeout')`,
    ),
    "t",
  );
  const retry = sql(claim);
  assert.notEqual(retry, next);
  assert.equal(
    sql(
      `select public.finish_scheduled_worker('provider-intake','${id}','${retry}')`,
    ),
    "t",
  );
  assert.equal(sql(claim), "unclaimed");
  console.log(
    "PASS: concurrent delivery claims once; expired leases recover; stale completion is fenced; failed jobs retry and completed delivery cannot replay.",
  );
} finally {
  sql("delete from worker_internal.scheduled_jobs");
  assert.equal(sql("select count(*) from worker_internal.scheduled_jobs"), "0");
  console.log("PASS: disposable worker receipts cleaned.");
}
