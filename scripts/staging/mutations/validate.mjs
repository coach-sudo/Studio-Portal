import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { Journal } from "./journal.mjs";
import { Executor } from "./engine.mjs";
import { seed, cleanup } from "./fixtures.mjs";
import { cases, runCases } from "./cases.mjs";
import {
  ids,
  target,
  users,
  email,
  assertConnection,
  assertIdentity,
  endpoint,
} from "./policy.mjs";
import { schemaDigest } from "./seal.mjs";
import { codeHash as executorCodeHash } from "../hosted-mutations.mjs";

class LocalAuth {
  constructor(db) {
    this.db = db;
  }
  async prepare(e) {
    for (const role of users) {
      const id = ids[role];
      const prior = (
        await this.db.query("select email from auth.users where id=$1", [id])
      ).rows[0];
      if (prior) {
        assert(e.journal.find("auth", role));
        assert.equal(prior.email, email(role));
      } else {
        await this.db.query(
          "insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),$3)",
          [id, email(role), { acceptanceRun: target.run }],
        );
        e.journal.append({ type: "auth", name: role, id });
      }
    }
  }
  async guardianRead() {
    await this.db.query("begin");
    try {
      await this.db.query("set local role authenticated");
      await this.db.query(
        "select set_config('request.jwt.claim.sub',$1,true)",
        [ids.guardian],
      );
      try {
        await this.db.query("select public.student_financial_overview($1)", [
          ids.student,
        ]);
        return true;
      } catch (err) {
        assert.match(err.message, /FORBIDDEN/);
        return false;
      }
    } finally {
      await this.db.query("rollback");
    }
  }
  async cleanup(role, e) {
    if (role === "coach") {
      e.journal.append({ type: "auth-retained", name: role, id: ids[role] });
      return;
    }
    await this.db.query("delete from auth.users where id=$1", [ids[role]]);
  }
}
export async function validateExecutor({ Client, config, root }) {
  assertConnection(config, true);
  const admin = new Client({
    ...config,
    user: "recovery_admin",
    database: "template1",
  });
  await admin.connect();
  const dir = join(root, "mutation-validation-" + Date.now());
  mkdirSync(dir);
  const results = [];
  let expectedSeal;
  const codeHash = executorCodeHash();
  async function run(name, body) {
    const database = "mutation_" + name.replaceAll("-", "_");
    assert.match(database, /^mutation_[a-z_]+$/);
    await admin.query(
      `create database ${database} with template postgres owner postgres`,
    );
    const db = new Client({ ...config, database });
    await db.connect();
    let journal;
    try {
      assert.equal(
        (
          await db.query(
            "select current_setting('studio.disposable_recovery') v",
          )
        ).rows[0].v,
        "wave-one-pr45-20261016",
      );
      await db.query("set search_path=pg_catalog");
      const seal = {
        candidate: target.application,
        sha256: await schemaDigest(db),
      };
      if (expectedSeal)
        assert.deepEqual(seal, expectedSeal, "Native clone schema drift");
      else {
        expectedSeal = seal;
        writeFileSync(
          new URL("./schema-seal.json", import.meta.url),
          JSON.stringify(seal, null, 2) + "\n",
        );
      }
      await db.query(
        "insert into public.studios(id,name,slug) values($1,'Manual test studio','manual-test-studio')",
        [target.studio],
      );
      // Deliberately pre-existing manual data must survive every executor/cleanup.
      await db.query(
        "insert into auth.users(id,email) values('11111111-1111-4111-8111-111111111111','manual@example.test')",
      );
      await db.query(
        "insert into public.students(id,studio_id,full_name) values('22222222-2222-4222-8222-222222222222',$1,'Manual student')",
        [target.studio],
      );
      const path = join(dir, name);
      mkdirSync(path);
      journal = new Journal(path, codeHash);
      const auth = new LocalAuth(db);
      const e = new Executor({ db, journal, auth, attest: async () => target });
      await e.initialize();
      await body(e, async () => {
        journal.close();
        journal = new Journal(path, codeHash);
        const next = new Executor({
          db,
          journal,
          auth,
          attest: async () => target,
        });
        await next.initialize();
        return next;
      });
      results.push({ name, passed: true });
      console.log("PASS mutation executor:", name);
    } finally {
      journal?.close();
      await db.end();
      await admin.query(`drop database ${database}`);
    }
  }
  try {
    await run("complete", async (e) => {
      await seed(e);
      await runCases(e);
      const report = await cleanup(e);
      assert.equal(report.retainedStudents.length, 2);
      assert.equal(
        e.journal.events.filter((x) => x.type === "case").length,
        16,
      );
      console.log("RPC requests:", e.rpcCount);
    });
    if (process.env.MUTATION_VALIDATE_QUICK !== "true") {
      await run("interrupt", async (e, resume) => {
        await seed(e);
        await cases.H01(e);
        let fired = false;
        e.inject = async (phase, name) => {
          if (!fired && phase === "after_commit" && name === "H02.create-1") {
            fired = true;
            throw Error("simulated disconnect");
          }
        };
        await assert.rejects(runCases(e), /simulated disconnect/);
        e = await resume();
        await runCases(e);
        await cleanup(e);
        assert.equal(
          e.journal.events.filter((x) => x.type === "case").length,
          16,
        );
      });
      await run("lost_apply_response", async (e, resume) => {
        await seed(e);
        e.inject = async (phase, name) => {
          if (phase === "after_commit" && name === "H03.apply-0")
            throw Error("lost apply response");
        };
        await assert.rejects(runCases(e), /lost apply response/);
        e = await resume();
        await runCases(e);
        await cleanup(e);
        assert.equal(
          e.journal.events.filter(
            (x) => x.type === "command" && x.name === "H03.apply-0",
          ).length,
          1,
        );
      });
      await run("rollback", async (e, resume) => {
        await seed(e);
        await cases.H01(e);
        e.inject = async (phase, name) => {
          if (phase === "before_commit" && name === "H02.create-0")
            throw Error("before commit");
        };
        await assert.rejects(cases.H02(e), /before commit/);
        e = await resume();
        await cases.H02(e);
        assert.equal(e.generated.size, 3);
        await cleanup(e);
      });
      await run("partial_cleanup", async (e, resume) => {
        await seed(e);
        await runCases(e);
        e.inject = async (phase, name) => {
          if (phase === "after_commit" && name === "cleanup.public-notes")
            throw Error("cleanup disconnect");
        };
        await assert.rejects(cleanup(e), /cleanup disconnect/);
        e = await resume();
        await cleanup(e);
        assert.equal(e.known["public.notes"].size, 0);
      });
      await run("permission", async (e) => {
        await seed(e);
        await assert.rejects(
          e.op("H01.permission", async () => {
            await e.db.query("set local role authenticated");
            await e.db.query(
              "select public.command_grant_student_credits($1,'forbidden','{}',$2)",
              [ids.student, ids.coach],
            );
          }),
          /permission denied/,
        );
        e.verify(await e.snapshot(), false);
        await cleanup(e);
      });
      await run("concurrent", async (e) => {
        await seed(e);
        const other = new Client({ ...config, database: e.db.database });
        await other.connect();
        try {
          const fake = new Executor({
            db: other,
            journal: e.journal,
            auth: e.auth,
            attest: async () => target,
          });
          await assert.rejects(fake.initialize(), /Concurrent executor/);
        } finally {
          await other.end();
        }
        await e.db.query(
          "update public.students set focus_area='unexpected writer' where id='22222222-2222-4222-8222-222222222222'",
        );
        await assert.rejects(
          e.op("H01.refuse", async () => true),
          /Pre-existing business row changed/,
        );
      });
      await run("guards", async (e) => {
        await seed(e);
        await assert.rejects(
          e.call("H01.unknown", "command_grant_student_credits", async () => [
            "22222222-2222-4222-8222-222222222222",
            "bad-key",
            { quantity: 1 },
            ids.coach,
          ]),
          /Unknown input ID/,
        );
        await assert.rejects(
          e.call("H01.rpc", "not_approved", async () => []),
          /Unapproved RPC/,
        );
        await assert.rejects(
          e.call("H01.unscoped", "claim_lesson_bulk_items", async () => [
            20,
            null,
          ]),
          /Scoped claim required/,
        );
        e.rpcCount = 100;
        await assert.rejects(
          e.call(
            "H01.overrun",
            "reserve_student_upcoming_credits",
            async () => [ids.student],
          ),
          /Command budget/,
        );
        await assert.rejects(
          e.op("H01.credit-budget", async () =>
            e.rpc("H01.credit-budget", "command_grant_student_credits", [
              ids.student,
              target.run + ":too-many",
              {
                quantity: 13,
                kind: "adjustment",
                packageId: ids.package,
                reason: target.run,
              },
              ids.coach,
            ]),
          ),
          /Credit budget/,
        );
        await assert.rejects(
          e.op("H01.cash-budget", async () => {
            await e.db.query(
              "update public.bookings set total_minor=10001 where id=$1",
              [ids["shared-prepaid"]],
            );
            return true;
          }),
          /Cash budget/,
        );
        await assert.rejects(
          e.op("H01.lesson-budget", async () => {
            for (let i = 0; i < 7; i++) {
              const date = new Date(
                Date.parse(
                  e.journal.find("committed", "seed.business").result.anchor,
                ) +
                  (200 + i) * 86400000,
              );
              await e.rpc("H01.lesson-budget-" + i, "command_create_lesson", [
                target.studio,
                ids.student,
                target.run + " Over-budget " + i,
                date.toISOString(),
                new Date(+date + 3600000).toISOString(),
                "in_person",
                "Synthetic studio",
                target.run + " Student 0",
                email("student-user"),
                "none",
                1,
                "America/New_York",
              ]);
            }
            return true;
          }),
          /Lesson record budget/,
        );
        await assert.rejects(
          e.op("H01.unknown-row", async () => {
            await e.db.query(
              "insert into public.students(id,studio_id,full_name) values('33333333-3333-4333-8333-333333333333',$1,$2)",
              [target.studio, target.run + " Unowned"],
            );
            return true;
          }),
          /Unowned/,
        );
        e.verify(await e.snapshot(), false);
        await cleanup(e);
      });
      await run("partial_provisioning", async (e) => {
        await e.auth.prepare(e);
        const result = await cleanup(e);
        assert.equal(result.partialProvisioning, true);
        assert(Object.values(e.known).every((rows) => rows.size === 0));
      });
      await run("cleanup_writer", async (e) => {
        await seed(e);
        const other = new Client({ ...config, database: e.db.database });
        await other.connect();
        try {
          await other.query("begin");
          await other.query("lock table public.notes in row exclusive mode");
          await assert.rejects(
            cleanup(e),
            /lock on relation|could not obtain lock/,
          );
          await other.query("rollback");
          await e.assert(
            "select count(*)::integer v from public.lessons where id=$1",
            [ids["lesson-delete"]],
            1,
          );
        } finally {
          await other.query("rollback");
          await other.end();
        }
        await cleanup(e);
      });
      await run("foreign_dependency", async (e) => {
        await seed(e);
        await e.db.query(
          "insert into public.notes(lesson_id,student_id,title,body) values($1,'22222222-2222-4222-8222-222222222222','Manual dependency','Must preserve')",
          [ids["lesson-delete"]],
        );
        await assert.rejects(cleanup(e), /Unexpected concurrent/);
        await e.assert(
          "select count(*)::integer v from public.lessons where id=$1",
          [ids["lesson-delete"]],
          1,
        );
      });
    }
    assert.throws(() => assertIdentity({ ...target, studio: "wrong" }));
    assert.throws(() =>
      assertIdentity({ ...target, project: "htwthzshhilrjtqwprlo" }),
    );
    assert.throws(() =>
      assertConnection(
        { ...config, host: "db.htwthzshhilrjtqwprlo.supabase.co" },
        true,
      ),
    );
    for (const url of [
      "https://portal.d-a-j.com",
      "https://api.stripe.com",
      target.origin + "/api/e2e/fixtures",
      target.origin + "/.netlify/functions/booking-maintenance",
    ])
      assert.equal(endpoint("POST", url), false);
    writeFileSync(
      join(dir, "results.json"),
      JSON.stringify(
        { postgres: 17, results, policyDenials: 7, hostedMutations: 0 },
        null,
        2,
      ),
    );
  } finally {
    await admin.end();
  }
}
