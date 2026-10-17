// Read-only post-cleanup verification. Does not import or instantiate Executor,
// read an authorization receipt, claim a lease, invoke a worker, or write a journal.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { privatePath } from "./protected-browser.mjs";
import { schemaQuery } from "./mutations/seal.mjs";
const sha = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const directory = privatePath(process.argv[2] || "");
const runtime = privatePath(process.env.STAGING_PG_RUNTIME_DIR || "");
const config = JSON.parse(
  readFileSync(join(directory, "mutation-config.json"), "utf8").replace(
    /^\uFEFF/,
    "",
  ),
);
assert.equal(config.database.host, "db.lrxrivfqjpkvygozphoz.supabase.co");
assert.equal(config.database.port, 5432);
assert.equal(config.database.ssl.rejectUnauthorized, true);
const events = readFileSync(join(directory, "mutation-journal.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
for (const [index, event] of events.entries()) {
  const { hash, ...content } = event;
  assert.equal(event.seq, index);
  assert.equal(event.previous, events[index - 1]?.hash || "");
  assert.equal(sha(content), hash);
}
assert(
  events.some((event) => event.type === "finished" && event.name === "H01-H16"),
);
assert.equal(events.filter((event) => event.type === "case").length, 16);
const initial = events.find(
  (event) => event.type === "state" && event.name === "baseline",
).snapshot;
const final = events.findLast((event) => event.type === "committed").snapshot;
assert.equal(Object.keys(final).length, 76);
const { Client } = createRequire(join(runtime, "package.json"))("pg");
const db = new Client({
  ...config.database,
  connectionTimeoutMillis: 10000,
  statement_timeout: 15000,
  application_name: "wave-one-release-baseline-readonly",
});
try {
  await db.connect();
  assert.equal(db.connection.stream.authorized, true);
  await db.query("begin isolation level repeatable read read only");
  await db.query("set local search_path=pg_catalog");
  const digest = (await db.query(schemaQuery())).rows[0].digest;
  const seal = JSON.parse(
    readFileSync(
      new URL("./mutations/schema-seal.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(digest, seal.sha256);
  let originalRows = 0,
    currentRows = 0;
  for (const [table, savedRows] of Object.entries(final)) {
    assert.match(table, /^(public|credit_internal|lesson_ops)\.[a-z_]+$/);
    const keys = (
      await db.query(
        "select a.attname from pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum where c.conrelid=$1::regclass and c.contype='p' order by k.n",
        [table],
      )
    ).rows.map((row) => row.attname);
    assert(keys.length);
    const current = new Map(
      (
        await db.query(
          `select to_jsonb(t) row from ${table
            .split(".")
            .map((name) => `"${name}"`)
            .join(".")} t`,
        )
      ).rows.map(({ row }) => [
        JSON.stringify(keys.map((key) => row[key])),
        sha(row),
      ]),
    );
    const expected = new Map([...initial[table], ...savedRows]);
    assert.equal(current.size, expected.size, `Unexpected row count: ${table}`);
    for (const [key, saved] of expected)
      assert.equal(
        current.get(key),
        saved.hash,
        `Changed retained/baseline record: ${table}`,
      );
    for (const [key, saved] of initial[table]) {
      assert.equal(
        current.get(key),
        saved.hash,
        `Original record changed: ${table}`,
      );
      originalRows++;
    }
    currentRows += current.size;
  }
  const migrations = (
    await db.query(
      "select version from supabase_migrations.schema_migrations order by version",
    )
  ).rows;
  assert.equal(migrations.length, 57);
  await db.query("rollback");
  const report = {
    verifiedAt: new Date().toISOString(),
    project: "lrxrivfqjpkvygozphoz",
    tlsVerified: true,
    readOnly: true,
    schemaSeal: digest,
    migrations: migrations.length,
    tables: 76,
    originalRows,
    currentRows,
    originalAndRetainedRowsUnchanged: true,
    completedJournalUnchanged: true,
    executorInvocations: 0,
    hostedBusinessWrites: 0,
  };
  if (process.argv[3])
    writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
    });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(
    "Read-only baseline verification failed:",
    error.code === "ERR_ASSERTION"
      ? error.message
      : error.code || "details suppressed",
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
