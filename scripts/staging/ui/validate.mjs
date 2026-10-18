// Native PostgreSQL 17 only. Every scenario gets a new disposable database.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UiExecutor, schemaSql } from "./engine.mjs";
import { UiJournal } from "./journal.mjs";
import { plan, ids, authIds, connection, sha } from "./policy.mjs";
import { seed, cleanup } from "./fixtures.mjs";
import { runCases, envelope } from "./cases.mjs";
import { localHttp } from "./local-http.mjs";
import { postcheck } from "./postcheck.mjs";
import { localBrowser } from "./local-browser.mjs";
import process from "node:process";
import console from "node:console";
const [runtime, portText, output] = process.argv.slice(2),
  port = Number(portText);
const { Client } = createRequire(join(runtime, "package.json"))("pg");
assert(port >= 49152 && port <= 65535);
const base = { host: "127.0.0.1", port, user: "postgres" };
const admin = new Client({
  ...base,
  user: "recovery_admin",
  database: "template1",
});
await admin.connect();
assert.equal(
  (
    await admin.query(
      "select current_setting('studio.disposable_recovery',true) marker",
    )
  ).rows[0].marker,
  "wave-one-pr45-20261016",
);
mkdirSync(output, { recursive: true });
const results = [];
const run = async (name, body) => {
  assert.match(name, /^[a-z_]+$/);
  const database = "ui_" + name;
  await admin.query(
    `create database ${database} with template postgres owner postgres`,
  );
  const config = { ...base, database };
  connection(config, true);
  let db, transport, journal;
  try {
    db = new Client(config);
    await db.connect();
    await db.query("set search_path=pg_catalog");
    await db.query(
      "insert into public.studios(id,name,slug) values($1,'UI local validation','ui-local-validation')",
      [plan.target.studio],
    );
    await db.query(
      "insert into public.students(id,studio_id,full_name) values('11111111-1111-4111-8111-111111111111',$1,'Pre-existing protected student')",
      [plan.target.studio],
    );
    const expectedSeal = (await db.query(schemaSql())).rows[0].digest;
    const dir = join(output, name);
    mkdirSync(dir);
    journal = new UiJournal(dir, "local-validation-executor", {
      local: true,
      database,
    });
    transport = await localHttp({ config, runtime });
    const auth = {
      verify: async (role, a) => {
        const u = (
          await db.query(
            "select email,email_confirmed_at,raw_app_meta_data from auth.users where id=$1",
            [a.id],
          )
        ).rows[0];
        assert(
          u &&
            u.email === a.email &&
            u.email_confirmed_at &&
            u.raw_app_meta_data.acceptanceRun === plan.runId,
          "Auth identity changed",
        );
      },
      create: async (role, a) => {
        const found = (
          await db.query("select id from auth.users where id=$1", [a.id])
        ).rowCount;
        assert.equal(found, 0);
        await db.query(
          "insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),$3)",
          [a.id, a.email, { acceptanceRun: plan.runId }],
        );
      },
      remove: async (role, id) => {
        assert.equal(id, authIds[role]);
        if (role === "coach")
          await db.query(
            "update auth.users set raw_app_meta_data=raw_app_meta_data||'{\"localBanned\":true}'::jsonb where id=$1",
            [id],
          );
        else await db.query("delete from auth.users where id=$1", [id]);
      },
    };
    const attest = async () => {
      assert.equal(config.host, "127.0.0.1");
      assert.equal(
        (
          await db.query(
            "select current_setting('studio.disposable_recovery',true) marker",
          )
        ).rows[0].marker,
        "wave-one-pr45-20261016",
      );
    };
    let e = new UiExecutor({
      db,
      journal,
      attest,
      http: transport.send,
      auth,
      expectedSeal,
    });
    await e.initialize();
    await body(
      e,
      async () => {
        journal.close();
        journal = new UiJournal(dir, "local-validation-executor", {
          local: true,
          database,
        });
        e = new UiExecutor({
          db,
          journal,
          attest,
          http: transport.send,
          auth,
          expectedSeal,
        });
        await e.initialize();
        return e;
      },
      config,
      transport,
    );
    results.push({
      name,
      status: "PASS",
      budgets: Object.fromEntries(
        [
          "http-business",
          "http-total",
          "sql",
          "read",
          "cleanup",
          "auth-admin",
        ].map((k) => [k, journal.count(k)]),
      ),
    });
    console.log("PASS UI executor:", name);
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
    console.error("FAIL UI executor:", name, error.message);
    throw error;
  } finally {
    journal?.close();
    await transport?.close();
    await db?.end();
    await admin.query(`drop database ${database}`);
  }
};
try {
  if (process.env.UI_BROWSER_DIST)
    await run("browser", async (e, _resume, _config, transport) => {
      await seed(e);
      const lane = await localBrowser({
        e,
        transport,
        dist: process.env.UI_BROWSER_DIST,
        output: join(output, "browser"),
      });
      try {
        await runCases(e, lane.driver);
      } finally {
        await lane.close();
      }
      const proof = await cleanup(e);
      await postcheck({
        db: e.db,
        baseline: e.baseline,
        retained: proof.retained,
        read: () => e.read(),
      });
      e.journal.append({ type: "case", name: "UI09" });
    });
  await run("complete", async (e) => {
    await seed(e);
    await runCases(e, { submit: (name, path, b) => e.http(name, path, b) });
    const proof = await cleanup(e);
    await postcheck({
      db: e.db,
      baseline: e.baseline,
      retained: proof.retained,
      read: () => e.read(),
    });
    assert.equal(proof.tables, 76);
    assert.equal(e.journal.events.filter((r) => r.type === "case").length, 8);
    assert(e.ownRows("public.package_credit_entries").length > 0);
    assert.equal(e.ownRows("public.packages").length, 1);
    assert.equal(
      (
        await e.db.query(
          "select count(*) n from auth.users where id=any($1::uuid[])",
          [Object.values(authIds)],
        )
      ).rows[0].n,
      "1",
    );
    e.journal.append({ type: "case", name: "UI09" });
  });
  await run("unknown_record", async (e) => {
    await seed(e);
    await assert.rejects(
      e.sql("adversarial.foreign", () =>
        e.db.query(
          "insert into public.students(id,studio_id,full_name) values('22222222-2222-4222-8222-222222222222',$1,'Unknown')",
          [plan.target.studio],
        ),
      ),
      /Unknown\/unowned/,
    );
  });
  await run("original_row", async (e) => {
    await seed(e);
    await assert.rejects(
      e.sql("adversarial.baseline", () =>
        e.db.query(
          "update public.students set full_name='Wrong' where id='11111111-1111-4111-8111-111111111111'",
        ),
      ),
      /Original business row changed/,
    );
  });
  await run("cash_budget", async (e) => {
    await seed(e);
    await assert.rejects(
      e.sql("adversarial.cash", () =>
        e.db.query("update public.lessons set price_minor=1 where id=$1", [
          ids["lesson-edit"],
        ]),
      ),
      /Cash\/price/,
    );
  });
  await run("delivery_activity", async (e) => {
    await seed(e);
    await assert.rejects(
      e.sql("adversarial.calendar", () =>
        e.db.query(
          "insert into public.calendar_projections(lesson_id,status,projected_version,attempts) values($1,'queued',0,1)",
          [ids["lesson-edit"]],
        ),
      ),
      /Calendar activity/,
    );
  });
  await run("durable_http_recovery", async (e, resume) => {
    await seed(e);
    e.inject = async (phase) => {
      if (phase === "after-durable-result")
        throw Error("Interrupt after durable result");
    };
    const body = envelope(
      "recovery.profile",
      "update",
      { focusArea: plan.runId + " focus" },
      e.ownRows("public.students").find((r) => r.id === ids.student).version,
      ids.student,
    );
    await assert.rejects(
      e.http("recovery.profile", "/api/v2/students", body),
      /Interrupt/,
    );
    e = await resume();
    assert(e.journal.find("committed", "recovery.profile").recovered);
    const count = e.journal.count("http-business");
    await e.http("recovery.profile", "/api/v2/students", body);
    assert.equal(e.journal.count("http-business"), count);
  });
  await run("lost_create_response", async (e, resume) => {
    await seed(e);
    e.inject = async (phase) => {
      if (phase === "after-response") throw Error("Lost create response");
    };
    const p = {
      studentId: ids.student,
      topic: plan.runId + " UI lesson",
      startsAt: plan.fixtureContent.uiCreate.startsAt,
      endsAt: plan.fixtureContent.uiCreate.endsAt,
      locationType: "in_person",
      locationLabel: "Synthetic staging room",
      recurrence: "none",
      studentEmail: plan.accounts.student.email,
    };
    await assert.rejects(
      e.http(
        "ambiguous.create",
        "/api/v2/lessons",
        envelope("ambiguous.create", "create", p),
      ),
      /Lost create/,
    );
    await assert.rejects(resume(), /Unresolved command/);
    assert.equal(
      (
        await e.db.query(
          "select count(*) n from public.lessons where student_id=$1",
          [ids.student],
        )
      ).rows[0].n,
      "13",
    );
  });
  await run("partial_cleanup", async (e, resume) => {
    await seed(e);
    await runCases(e, { submit: (name, path, b) => e.http(name, path, b) });
    e.inject = async (phase, name) => {
      if (
        phase === "after-sql-commit" &&
        name === "cleanup.public.calendar_projections"
      )
        throw Error("Cleanup interrupted");
    };
    await assert.rejects(cleanup(e), /Cleanup interrupted/);
    e = await resume();
    await cleanup(e);
    assert.equal(e.ownRows("public.calendar_projections").length, 0);
  });
  await run("concurrent_writer", async (e, _resume, config) => {
    await seed(e);
    const other = new Client(config);
    await other.connect();
    try {
      await other.query(
        "update public.students set focus_area='Concurrent' where id=$1",
        [ids.student],
      );
      await assert.rejects(
        e.http(
          "concurrent.profile",
          "/api/v2/students",
          envelope(
            "concurrent.profile",
            "update",
            { focusArea: plan.runId + " focus" },
            1,
            ids.student,
          ),
        ),
        /Concurrent writer/,
      );
    } finally {
      await other.end();
    }
  });
  await run("permission_denied", async (e) => {
    await seed(e);
    await assert.rejects(
      e.http(
        "denied",
        "/api/v2/credits",
        envelope("denied", "set_auto", {
          studentId: ids.student,
          enabled: true,
        }),
        "student",
      ),
      /Mutation role denied/,
    );
    assert.equal(e.journal.count("http-business"), 1);
  });
  await run("forged_receipt", async (e) => {
    await seed(e);
    await assert.rejects(
      e.sql("adversarial.receipt", () =>
        e.db.query(
          "insert into lesson_ops.receipts(key,actor_id,studio_id,request,response) values('unsubmitted-key',$1,$2,$3,'{}')",
          [authIds.coach, plan.target.studio, { lessonId: ids["lesson-edit"] }],
        ),
      ),
      /Unknown\/unowned/,
    );
    assert.equal(e.ownRows("lesson_ops.receipts").length, 0);
  });
  await run("parallel_executor", async (e) => {
    await seed(e);
    let release;
    const hold = new Promise((r) => {
      release = r;
    });
    const attest = e.attest;
    e.attest = async () => {
      await hold;
      await attest();
    };
    const first = e.sql("parallel.first", async () => ({ ok: true }));
    await assert.rejects(
      e.sql("parallel.second", async () => ({ wrong: true })),
      /Concurrent executor/,
    );
    release();
    await first;
    assert(!e.journal.find("committed", "parallel.second"));
  });
  await run("baseline_approval", async (e) => {
    e.initialBaselineHash = "f".repeat(64);
    await assert.rejects(e.initialize(), /Journal baseline differs/);
  });
  await run("credit_budget", async (e) => {
    await seed(e);
    await assert.rejects(
      e.sql("adversarial.credit", () =>
        e.db.query(
          "insert into public.package_credit_entries(package_id,kind,quantity,reason) values($1,'purchase',5,'local budget adversary')",
          [ids.package],
        ),
      ),
      /Granted credit budget/,
    );
    assert.equal(e.ownRows("public.package_credit_entries").length, 0);
  });
  await run("auth_ambiguity", async (e) => {
    const create = e.auth.create;
    e.auth.create = async (role, a) => {
      await create(role, a);
      throw Error("Lost Auth creation response");
    };
    await assert.rejects(seed(e), /Lost Auth/);
    await assert.rejects(seed(e), /Ambiguous Auth provisioning/);
    assert.equal(
      (
        await e.db.query(
          "select count(*) n from auth.users where id=any($1::uuid[])",
          [Object.values(authIds)],
        )
      ).rows[0].n,
      "1",
    );
    e.verify(await e.capture(), false);
  });
  await run("auth_role_drift", async (e) => {
    await seed(e);
    await e.db.query(
      "update auth.users set email='foreign@example.test' where id=$1",
      [authIds.student],
    );
    await assert.rejects(seed(e), /Auth identity changed/);
  });
} finally {
  await admin.end();
  writeFileSync(
    join(output, "ui-validation.json"),
    JSON.stringify(
      {
        environment:
          "Disposable native PostgreSQL 17; real v2 handler/SQL/RLS; local Auth and REST compatibility adapter",
        manifest: sha(plan),
        results,
      },
      null,
      2,
    ) + "\n",
  );
}
