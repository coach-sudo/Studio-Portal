import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { setTimeout } from "node:timers";
import { URL } from "node:url";
if (!process.env.STAGING_PG_RUNTIME_DIR)
  throw Error(
    "STAGING_PG_RUNTIME_DIR is required; use a disposable directory outside the checkout",
  );
const root = resolve(process.env.STAGING_PG_RUNTIME_DIR);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (
  root === repo ||
  root.startsWith(repo + "/") ||
  root.startsWith(repo + "\\")
)
  throw Error("Runtime must be outside repository");
const require = createRequire(join(root, "package.json"));
const { Client } = require("pg");
const { initdb, pg_ctl } = await import(
  pathToFileURL(
    join(root, "node_modules/@embedded-postgres/windows-x64/dist/index.js"),
  ).href
);
writeFileSync(
  root + "/pg-client-bridge.mjs",
  readFileSync(new URL("./pg-client-bridge.mjs", import.meta.url)),
);
const data = root + "/cluster-" + Date.now();
mkdirSync(data);
const run = (bin, args) =>
  execFileSync(bin, args, { encoding: "utf8", windowsHide: true });
console.log(run(initdb, ["--version"]).trim());
run(initdb, [
  "-D",
  data,
  "-U",
  "recovery_bootstrap",
  "-A",
  "trust",
  "--encoding=UTF8",
  "--locale=C",
]);
const port = 56435;
execFileSync(
  pg_ctl,
  [
    "-D",
    data,
    "-l",
    data + "/server.log",
    "-o",
    `-h 127.0.0.1 -p ${port} -c wal_level=logical -c studio.disposable_recovery=wave-one-pr45-20261016`,
    "-w",
    "start",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const config = {
  host: "127.0.0.1",
  port,
  user: "postgres",
  database: "postgres",
};
const bootstrap = new Client({ ...config, user: "recovery_bootstrap" });
const client = new Client(config);
try {
  try {
    await bootstrap.connect();
    await bootstrap.query(
      "create role postgres login superuser;alter database postgres owner to postgres;alter schema public owner to postgres",
    );
  } finally {
    await bootstrap.end();
  }
  await client.connect();
  await client.query(`create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin;create role supabase_storage_admin;
 grant anon,authenticated,service_role to postgres;
 create schema auth;create schema storage;create schema extensions;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',email_confirmed_at timestamptz,aud text,role text,encrypted_password text,instance_id uuid,created_at timestamptz,updated_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),auth.jwt()->>'role')$$;
 create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text,owner uuid,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now());alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
 create function storage.filename(name text) returns text language sql immutable as $$select reverse(split_part(reverse(name),'/',1))$$;
 create function storage.extension(name text) returns text language sql immutable as $$select reverse(split_part(reverse(name),'.',1))$$;
 create extension pgcrypto with schema extensions;
 create publication supabase_realtime;
 grant usage on schema public,auth,storage,extensions to anon,authenticated,service_role;
 grant all on all tables in schema auth,storage to service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
 set search_path=public,extensions;
 `);
  const files = execFileSync(
    "git",
    [
      "ls-tree",
      "--name-only",
      "fe63c57e928bca78c23e43877480b36a2d8e26c6:supabase/migrations",
    ],
    { cwd: repo, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .sort();
  for (const file of files.slice(0, 35)) {
    let sql = execFileSync(
      "git",
      [
        "show",
        "fe63c57e928bca78c23e43877480b36a2d8e26c6:supabase/migrations/" + file,
      ],
      { cwd: repo, encoding: "utf8" },
    );
    if (process.env.REPLAY_CRLF === "true") sql = sql.replace(/\n/g, "\r\n");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      console.log("FAILED", file, e.message);
      throw e;
    }
  }
  const row = (
    await client.query(
      `select pg_get_functiondef(oid) as definition,to_jsonb(p) as properties from pg_proc p where oid='public.command_make_lesson_recurring(uuid,integer,text,integer,text)'::regprocedure`,
    )
  ).rows[0];
  if (process.env.REPLAY_CRLF !== "true")
    writeFileSync(
      root + "/local-lf-function.json",
      JSON.stringify(row, null, 2),
    );
  const before = JSON.parse(
    readFileSync(root + "/staging-before.json", "utf8"),
  ).function;
  console.log(
    JSON.stringify({
      replayed: 35,
      normalizedDefinitionMatches:
        row.definition.replace(/\r\n/g, "\n") ===
        before.definition.replace(/\r\n/g, "\n"),
    }),
  );
  if (process.env.REPLAY_CRLF === "true") {
    assert.equal(row.definition, before.definition);
    const failed = execFileSync(
      "git",
      [
        "show",
        "fe63c57e928bca78c23e43877480b36a2d8e26c6:supabase/migrations/" +
          files[35],
      ],
      { cwd: repo, encoding: "utf8" },
    );
    await client.query("create role recovery_admin login superuser");
    const admin = new Client({ ...config, user: "recovery_admin" });
    await admin.connect();
    await admin.query("alter role postgres nosuperuser");
    await admin.end();
    assert.equal(
      (
        await client.query(
          "select rolsuper from pg_roles where rolname=current_user",
        )
      ).rows[0].rolsuper,
      false,
    );
    console.log("PASS: recovery testing uses a non-superuser function owner");
    await client.query("begin");
    await assert.rejects(
      client.query(failed),
      (e) =>
        e.code === "P0001" &&
        e.message ===
          "Expected redundant i declaration was not found in command_make_lesson_recurring",
    );
    await client.query("rollback");
    console.log(
      "PASS: original CRLF failure reproduced with unchanged migration",
    );
    await client.query(
      "create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])",
    );
    for (const f of files.slice(0, 35))
      await client.query(
        "insert into supabase_migrations.schema_migrations(version,name) values($1,$2)",
        [f.split("_")[0], f.slice(f.indexOf("_") + 1, -4)],
      );
    const recovery = readFileSync(
      repo + "/scripts/staging/recover-recurring-crlf.sql",
      "utf8",
    );
    const all = async () =>
      (
        await client.query(
          `select oid,to_jsonb(p) as properties from pg_proc p where pronamespace in (select oid from pg_namespace where nspname in ('public','private','auth','storage')) order by oid`,
        )
      ).rows;
    const allBefore = await all();
    async function behavior() {
      await client.query("begin");
      try {
        await client.query(`insert into public.studios(id,name,slug) values('ef000000-0000-4000-8000-000000000001','e2e CRLF','e2e-crlf');
     insert into public.students(id,studio_id,full_name,status) values('ef000000-0000-4000-8000-000000000002','ef000000-0000-4000-8000-000000000001','e2e Student','active');
     insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label) values('ef000000-0000-4000-8000-000000000003','ef000000-0000-4000-8000-000000000001','ef000000-0000-4000-8000-000000000002','e2e recurring','2035-01-01T14:00Z','2035-01-01T15:00Z','scheduled','virtual','e2e');`);
        const result = (
          await client.query(
            `select public.command_make_lesson_recurring('ef000000-0000-4000-8000-000000000003',1,'weekly',3,'America/New_York') r`,
          )
        ).rows[0].r;
        const stats = (
          await client.query(
            `select jsonb_build_object('occurrences',$1::int,'lessons',(select count(*) from lessons where student_id='ef000000-0000-4000-8000-000000000002'),'starts',(select jsonb_agg(starts_at order by starts_at) from lessons where student_id='ef000000-0000-4000-8000-000000000002'),'projection_count',(select count(*) from calendar_projections cp join lessons l on l.id=cp.lesson_id where l.student_id='ef000000-0000-4000-8000-000000000002')) r`,
            [result.occurrenceCount],
          )
        ).rows[0].r;
        assert.equal(stats.lessons, 3);
        return stats;
      } finally {
        await client.query("rollback");
      }
    }
    const behaviorBefore = await behavior();
    await client.query(recovery);
    const allAfter = await all();
    assert.equal(allBefore.length, allAfter.length);
    const target = allBefore.find(
      (x) => x.properties.proname === "command_make_lesson_recurring",
    );
    for (let i = 0; i < allBefore.length; i++) {
      const expected = JSON.parse(JSON.stringify(allBefore[i]));
      if (expected.oid === target.oid)
        expected.properties.prosrc = expected.properties.prosrc.replace(
          /\r\n/g,
          "\n",
        );
      assert.deepEqual(allAfter[i], expected);
    }
    assert.deepEqual(await behavior(), behaviorBefore);
    console.log(
      "PASS: exact definition, all catalog properties, unrelated functions and recurring behavior preserved",
    );
    await client.query(recovery);
    assert.deepEqual(await all(), allAfter);
    console.log("PASS: exact repeat is a no-op");
    await client.query(
      `create function public.command_make_lesson_recurring() returns void language sql as $$select$$`,
    );
    await assert.rejects(client.query(recovery), /unexpected overload count/);
    await client.query("rollback");
    await client.query("drop function public.command_make_lesson_recurring()");
    console.log("PASS: unexpected overload rejected transactionally");
    await client.query(
      "alter function public.command_make_lesson_recurring(uuid,integer,text,integer,text) reset search_path",
    );
    await assert.rejects(
      client.query(recovery),
      /unexpected ownership, ACL or configuration/,
    );
    await client.query("rollback");
    await client.query(
      "alter function public.command_make_lesson_recurring(uuid,integer,text,integer,text) set search_path = public, pg_temp",
    );
    console.log("PASS: configuration drift rejected");
    await client.query(
      row.definition.replace(
        "  base public.lessons%rowtype;",
        "  base  public.lessons%rowtype;",
      ),
    );
    await assert.rejects(
      client.query(recovery),
      /normalized definition differs/,
    );
    await client.query("rollback");
    await client.query(row.definition);
    await client.query(recovery);
    console.log(
      "PASS: unexpected business definition rejected; verified definition restored locally",
    );
    await client.query(row.definition);
    const holder = new Client(config);
    const racer = new Client(config);
    await holder.connect();
    await racer.connect();
    try {
      await holder.query(
        "begin;alter function public.command_make_lesson_recurring(uuid,integer,text,integer,text) set search_path = public, pg_temp",
      );
      const pid = (await racer.query("select pg_backend_pid() pid")).rows[0]
        .pid;
      const waiting = racer.query(recovery).then(
        () => ({ ok: true }),
        (e) => ({ ok: false, code: e.code, message: e.message }),
      );
      await new Promise((r) => setTimeout(r, 200));
      assert.ok(
        (
          await client.query("select cardinality(pg_blocking_pids($1)) n", [
            pid,
          ])
        ).rows[0].n > 0,
      );
      await holder.query("commit");
      const outcome = await waiting;
      assert.equal(outcome.ok, false);
      assert.equal(outcome.code, "XX000");
      await racer.query("rollback");
      assert.equal(
        (
          await client.query(
            `select pg_get_functiondef('public.command_make_lesson_recurring(uuid,integer,text,integer,text)'::regprocedure) d`,
          )
        ).rows[0].d,
        row.definition,
      );
      await client.query(recovery);
    } finally {
      await holder.end();
      await racer.end();
    }
    console.log(
      "PASS: concurrent writer contention observed, recovery fails closed, verified retry succeeds",
    );
    await client.query("begin");
    await client.query(failed);
    await client.query("commit");
    console.log(
      "PASS: original unchanged historical repair succeeds after normalization",
    );
    for (const file of files.slice(36)) {
      const sql = execFileSync(
        "git",
        [
          "show",
          "fe63c57e928bca78c23e43877480b36a2d8e26c6:supabase/migrations/" +
            file,
        ],
        { cwd: repo, encoding: "utf8" },
      );
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        console.log("FAILED later", file, e.message);
        throw e;
      }
    }
    console.log("PASS: all 57 original migrations replayed on PostgreSQL 17");
    const catalog = (
      await client.query(
        readFileSync(repo + "/scripts/staging/schema-fingerprint.sql", "utf8"),
      )
    ).rows[0].catalog;
    writeFileSync(root + "/expected-full-schema.json", JSON.stringify(catalog));
    const tests = execFileSync(
      "git",
      [
        "ls-tree",
        "--name-only",
        "fe63c57e928bca78c23e43877480b36a2d8e26c6:supabase/tests",
      ],
      { cwd: repo, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .sort();
    // Install pgTAP with the disposable bootstrap administrator; test queries
    // continue to run as the non-superuser owner and their explicit portal roles.
    const tapAdmin = new Client({ ...config, user: "recovery_bootstrap" });
    await tapAdmin.connect();
    await tapAdmin.query("create extension pgtap with schema extensions");
    await tapAdmin.end();
    let assertions = 0;
    for (const file of tests) {
      const sql = execFileSync(
        "git",
        [
          "show",
          "fe63c57e928bca78c23e43877480b36a2d8e26c6:supabase/tests/" + file,
        ],
        { cwd: repo, encoding: "utf8" },
      );
      const results = await client.query(sql);
      const lines = results
        .flatMap((r) => (r.rows || []).flatMap((row) => Object.values(row)))
        .filter((v) => typeof v === "string");
      assert.equal(
        lines.filter((l) => /^not ok\b/m.test(l)).length,
        0,
        file +
          " TAP failures: " +
          lines.filter((l) => /^not ok\b/m.test(l)).join("\n"),
      );
      const n = lines.filter((l) => /^ok \d+/m.test(l)).length;
      assertions += n;
      console.log("PASS: pgTAP " + file + " (" + n + " assertions)");
    }
    for (const name of [
      "test-credit-concurrency.mjs",
      "test-lesson-change-concurrency.mjs",
      "test-lesson-bulk-concurrency.mjs",
    ]) {
      const source = execFileSync(
        "git",
        ["show", "fe63c57e928bca78c23e43877480b36a2d8e26c6:scripts/" + name],
        { cwd: repo, encoding: "utf8" },
      );
      const prefix = `import assert from 'node:assert/strict';import {execFileSync,spawn} from 'node:child_process';
const args=[${JSON.stringify(root + "/pg-client-bridge.mjs")},'${port}'];
const query=sql=>execFileSync(process.execPath,args,{input:sql,encoding:'utf8',windowsHide:true}).trim();
function session(sql,onOutput=()=>{}){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{windowsHide:true});let output='',error='';child.stdout.on('data',data=>{output+=data;onOutput(output)});child.stderr.on('data',data=>error+=data);child.on('error',reject);child.on('close',code=>code?reject(new Error(error)):resolve(output));child.stdin.end(sql)});}
`;
      assert.ok(source.includes("const coach ="));
      writeFileSync(
        root + "/adapted-" + name,
        prefix + source.slice(source.indexOf("const coach =")),
      );
      const out = execFileSync(process.execPath, [root + "/adapted-" + name], {
        encoding: "utf8",
        windowsHide: true,
      });
      console.log(out.trim());
    }
    console.log(
      "PASS: " +
        assertions +
        " pgTAP assertions and all three original concurrency scenario bodies",
    );
    writeFileSync(
      root + "/recovery-test-result.json",
      JSON.stringify(
        {
          postgres: 17,
          reproduced: true,
          exactDefinition: true,
          catalogEquivalent: true,
          behaviorEquivalent: true,
          repeatNoop: true,
          overloadRejected: true,
          configurationDriftRejected: true,
          businessDefinitionDriftRejected: true,
          catalogContentionObserved: true,
          historicalRepairPassed: true,
          fullChain: 57,
          pgtapAssertions: assertions,
          concurrencySuites: 3,
        },
        null,
        2,
      ),
    );
  }
} finally {
  try {
    await client.end();
  } finally {
    run(pg_ctl, ["-D", data, "-m", "fast", "-w", "stop"]);
  }
}
