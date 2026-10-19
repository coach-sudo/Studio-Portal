// Disposable native PG17 only. Hosted Auth/perimeter are NOT represented here.
import assert from "node:assert/strict";
import fs from "node:fs";
import process from "node:process";
import console from "node:console";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const runtime = process.env.STUDIO_LOCAL_PG_RUNTIME;
assert(runtime);
const { Client } = createRequire(join(runtime, "package.json"))("pg");
const { initdb, pg_ctl } = await import(
  pathToFileURL(
    join(runtime, "node_modules/@embedded-postgres/windows-x64/dist/index.js"),
  ).href
);
const root = join(runtime, "notice-cutover-" + Date.now()),
  data = join(root, "data");
fs.mkdirSync(root);
const bin = (path, args) =>
  execFileSync(path, args, { stdio: "ignore", windowsHide: true });
bin(initdb, [
  "-D",
  data,
  "-U",
  "postgres",
  "-A",
  "trust",
  "--encoding=UTF8",
  "--locale=C",
]);
bin(pg_ctl, [
  "-D",
  data,
  "-l",
  join(root, "postgres.log"),
  "-o",
  "-h 127.0.0.1 -p 56439 -c wal_level=logical -c studio.combined_disposable=focused-ui",
  "-w",
  "start",
]);
const config = {
  host: "127.0.0.1",
  port: 56439,
  user: "postgres",
  database: "ui_notice_cutover",
};
let db;
const passed = [];
try {
  const admin = new Client({ ...config, database: "postgres" });
  await admin.connect();
  await admin.query("create database ui_notice_cutover");
  await admin.end();
  db = new Client(config);
  await db.connect();
  assert.equal(
    (await db.query("select current_setting('studio.combined_disposable') v"))
      .rows[0].v,
    "focused-ui",
  );
  const bootstrap = fs
    .readFileSync("scripts/staging/test-recurring-crlf-recovery.mjs", "utf8")
    .replace(/\r\n/g, "\n")
    .match(/await client\.query\(`(create role anon;[\s\S]*?)`\);/)[1];
  await db.query(bootstrap);
  const files = fs
    .readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.equal(files.length, 60);
  for (const f of files.slice(0, -2))
    await db.query(
      fs
        .readFileSync(join("supabase/migrations", f), "utf8")
        .replace(/\r\n/g, "\n"),
    );
  const { randomUUID, createHash } = await import("node:crypto");
  const studio = randomUUID(),
    student = randomUUID(),
    otherStudent = randomUUID();
  await db.query(
    "insert into public.studios(id,name,slug) values($1,'Local cutover','notice-cutover')",
    [studio],
  );
  for (const id of [student, otherStudent]) {
    await db.query(
      "insert into public.students(id,studio_id,full_name,email,portal_enabled) values($1,$2,'Local synthetic','local@example.test',false)",
      [id, studio],
    );
    await db.query(
      "insert into public.student_credit_accounts(student_id,auto_apply) values($1,false)",
      [id],
    );
  }
  let slot = 0;
  const newLesson = async () => {
    const id = randomUUID();
    await db.query(
      "insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,price_minor,paid_minor,payment_status,source_provider) values($1,$2,$3,'Local transition',$4,$5,'scheduled','in_person','Local',0,0,'due','studio')",
      [
        id,
        studio,
        student,
        new Date(Date.UTC(2099, 0, ++slot, 12)).toISOString(),
        new Date(Date.UTC(2099, 0, slot, 13)).toISOString(),
      ],
    );
    return id;
  };
  const transition = async (action = "cancel", id) => {
    id ||= await newLesson();
    const before = (
      await db.query(
        "select version,starts_at,ends_at from public.lessons where id=$1",
        [id],
      )
    ).rows[0];
    await db.query("select set_config('app.use_credit','true',false)");
    await db.query(
      "select public.command_change_lesson_state($1,$2,$3,$4,$5,false)",
      [
        id,
        before.version,
        action,
        action === "reschedule"
          ? new Date(+before.starts_at + 7200000).toISOString()
          : null,
        action === "reschedule"
          ? new Date(+before.ends_at + 7200000).toISOString()
          : null,
      ],
    );
    return (
      await db.query(
        "select * from lesson_ops.effects where lesson_id=$1 order by created_at desc limit 1",
        [id],
      )
    ).rows[0];
  };
  const notice = (
    e,
    producer = "new",
    recipient = "student@example.test",
    extra = {},
  ) => ({
    studio_id: studio,
    student_id: student,
    lesson_id: e.lesson_id,
    booking_id: null,
    channel: "email",
    recipient,
    body: "Local only",
    status: "queued",
    event_key: `lesson.${e.kind}.student`,
    dedupe_key: `lesson:${e.lesson_id}:${producer === "new" ? e.id : e.lesson_version}:${e.kind}:student:${recipient}`,
    entity_snapshot: {
      startsAt: e.snapshot.startsAt,
      endsAt: e.snapshot.endsAt,
      ...(producer === "new" ? { changeId: e.id } : {}),
    },
    ...extra,
  });
  const insert = async (client, m) => {
    try {
      return {
        inserted: (
          await client.query(
            "insert into public.outbox_messages(studio_id,student_id,lesson_id,booking_id,channel,recipient,body,status,event_key,dedupe_key,entity_snapshot,suppression_reason) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id,dedupe_key,status",
            [
              "studio_id",
              "student_id",
              "lesson_id",
              "booking_id",
              "channel",
              "recipient",
              "body",
              "status",
              "event_key",
              "dedupe_key",
              "entity_snapshot",
              "suppression_reason",
            ].map((k) => m[k] ?? null),
          )
        ).rows[0],
      };
    } catch (err) {
      if (
        err.code === "23505" &&
        err.message.includes("outbox_messages_dedupe_idx")
      )
        return { duplicate: true };
      throw err;
    }
  };
  const count = async (e) =>
    (
      await db.query(
        "select count(*) n from public.outbox_messages where lesson_id=$1",
        [e.lesson_id],
      )
    ).rows[0].n;
  const anchor = await transition();
  const original = await insert(
    db,
    notice(anchor, "old", "anchor@example.test", { status: "sent" }),
  );
  const before = (
    await db.query("select to_jsonb(o) value from public.outbox_messages o")
  ).rows;
  await db.query(
    fs
      .readFileSync(join("supabase/migrations", files.at(-2)), "utf8")
      .replace(/\r\n/g, "\n"),
  );
  await db.query(
    fs
      .readFileSync(join("supabase/migrations", files.at(-1)), "utf8")
      .replace(/\r\n/g, "\n"),
  );
  assert.deepEqual(
    (await db.query("select to_jsonb(o) value from public.outbox_messages o"))
      .rows,
    before,
  );
  assert(
    (await insert(db, notice(anchor, "new", "anchor@example.test"))).duplicate,
  );
  assert.equal(await count(anchor), "1");
  assert.equal(
    (
      await db.query(
        "select dedupe_key,status from public.outbox_messages where id=$1",
        [original.inserted.id],
      )
    ).rows[0].dedupe_key,
    original.inserted.dedupe_key,
  );
  passed.push("migration_preserves_pretrigger_delivered_legacy_anchor");
  for (const first of ["old", "new"]) {
    const e = await transition();
    assert((await insert(db, notice(e, first))).inserted);
    assert((await insert(db, notice(e, first))).duplicate);
    assert(
      (await insert(db, notice(e, first === "old" ? "new" : "old"))).duplicate,
    );
    assert.equal(await count(e), "1");
    passed.push(
      first === "old"
        ? "legacy_only_and_legacy_then_effect_retry"
        : "effect_only_and_effect_then_legacy_retry",
    );
  }
  const legacyLesson = await newLesson();
  const l = (
    await db.query("select * from public.lessons where id=$1", [legacyLesson])
  ).rows[0];
  const legacy = {
    id: randomUUID(),
    lesson_id: l.id,
    lesson_version: l.version,
    kind: "rescheduled",
    snapshot: { startsAt: l.starts_at, endsAt: l.ends_at },
  };
  assert((await insert(db, notice(legacy, "old"))).inserted);
  assert((await insert(db, notice(legacy, "old"))).duplicate);
  passed.push("pre_effect_legacy_fallback_preserved");
  for (const status of ["queued", "suppressed", "cancelled", "sent"]) {
    const e = await transition();
    const actualStatus = status === "suppressed" ? "cancelled" : status;
    const m = notice(e, "old", "state@example.test", {
      status: actualStatus,
      ...(status === "suppressed"
        ? { suppression_reason: "synthetic_preference" }
        : {}),
    });
    const r = await insert(db, m);
    assert((await insert(db, notice(e))).inserted);
    assert(
      (await insert(db, notice(e, "new", "state@example.test"))).duplicate,
    );
    assert.equal(
      (
        await db.query(
          "select status from public.outbox_messages where id=$1",
          [r.inserted.id],
        )
      ).rows[0].status,
      actualStatus,
    );
  }
  passed.push("queued_suppressed_cancelled_delivered_states_not_reset");
  const partial = await transition();
  await insert(db, notice(partial, "old", "a@example.test")); // Second recipient fails before transmission.
  assert(
    (await insert(db, notice(partial, "new", "a@example.test"))).duplicate,
  );
  assert((await insert(db, notice(partial, "new", "b@example.test"))).inserted);
  assert(
    (await insert(db, notice(partial, "new", "b@example.test"))).duplicate,
  );
  assert.equal(await count(partial), "2");
  passed.push(
    "partial_queue_failure_and_interrupted_worker_retry_fill_only_missing_recipients",
  );
  const reschedule = await transition("reschedule");
  await insert(db, notice(reschedule));
  const second = await transition("cancel", reschedule.lesson_id);
  await insert(db, notice(second));
  assert.equal(await count(second), "2");
  passed.push("separate_reschedule_and_cancellation_events_preserved");
  const contexts = await transition();
  await db.query("update lesson_ops.effects set student_ids=$2 where id=$1", [
    contexts.id,
    [student, otherStudent],
  ]);
  await insert(db, notice(contexts, "old", "guardian-a@example.test"));
  await insert(
    db,
    notice(contexts, "new", "guardian-b@example.test", {
      student_id: otherStudent,
    }),
  );
  assert.equal(await count(contexts), "2");
  await assert.rejects(
    () =>
      insert(
        db,
        notice(contexts, "new", "wrong@example.test", {
          student_id: randomUUID(),
        }),
      ),
    /INVALID_NOTIFICATION_IDENTITY/,
  );
  await assert.rejects(
    () =>
      insert(
        db,
        notice(contexts, "new", "wrong@example.test", {
          studio_id: randomUUID(),
        }),
      ),
    /INVALID_NOTIFICATION_IDENTITY/,
  );
  passed.push("recipient_student_and_studio_contexts_fenced");

  // Distinct participant withdrawals can share a lesson version and recipient.
  // Their booking-bound effect IDs must remain distinct, including guests.
  const classId = await newLesson();
  await db.query(
    "update public.lessons set student_id=null,capacity=2 where id=$1",
    [classId],
  );
  const service = randomUUID();
  await db.query(
    "insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor) values($1,$2,'local-class','Local class','private',60,0)",
    [service, studio],
  );
  const withdrawals = [];
  for (let n = 0; n < 2; n++) {
    const bid = randomUUID(),
      pid = randomUUID();
    await db.query(
      "insert into public.bookings(id,studio_id,reference,service_id,guest_name,guest_email,starts_at,ends_at,timezone,location,status,payment_policy,payment_status,total_minor,policy_snapshot,manage_token_hash) select $1::uuid,$2::uuid,$1::text,$3::uuid,'Local guest',$4,starts_at,ends_at,'UTC','in_person','cancelled','pay_later','not_required',0,'{}',$1::text from public.lessons where id=$5",
      [bid, studio, service, "guest" + n + "@example.test", classId],
    );
    await db.query(
      "insert into public.lesson_participants(id,lesson_id,booking_id,display_name,email,status) values($1,$2,$3,'Local guest',$4,'cancelled')",
      [pid, classId, bid, "guest" + n + "@example.test"],
    );
    const eid = (
      await db.query(
        "select lesson_ops.queue_effect($1,'cancelled','{}',$2,$3,$4) id",
        [classId, [pid], bid, "guest-withdrawal-" + n],
      )
    ).rows[0].id;
    withdrawals.push(
      (await db.query("select * from lesson_ops.effects where id=$1", [eid]))
        .rows[0],
    );
  }
  for (const e of withdrawals) {
    const m = notice(e, "old", "shared-guardian@example.test", {
      student_id: null,
      booking_id: e.booking_id,
    });
    m.dedupe_key =
      "lesson:" +
      e.lesson_id +
      ":" +
      e.lesson_version +
      ":cancelled:" +
      e.booking_id +
      ":student:" +
      m.recipient;
    assert((await insert(db, m)).inserted);
    assert(
      (
        await insert(
          db,
          notice(e, "new", m.recipient, {
            student_id: null,
            booking_id: e.booking_id,
          }),
        )
      ).duplicate,
    );
  }
  assert.equal(await count(withdrawals[0]), "2");
  passed.push("same_version_guest_withdrawals_keep_distinct_booking_contexts");
  const fail = await transition();
  await assert.rejects(
    () =>
      insert(
        db,
        notice(fail, "new", "wrong@example.test", {
          entity_snapshot: { ...fail.snapshot, changeId: randomUUID() },
        }),
      ),
    /INVALID_NOTIFICATION_IDENTITY/,
  );
  await db.query("begin isolation level repeatable read");
  await assert.rejects(() => insert(db, notice(fail)), /READ COMMITTED/);
  await db.query("rollback");
  passed.push("forged_effect_and_stale_snapshot_isolation_rejected");
  for (const first of ["old", "new"]) {
    const e = await transition();
    const a = new Client(config),
      b = new Client(config);
    await a.connect();
    await b.connect();
    try {
      await a.query("begin");
      await a.query("set local statement_timeout='8000'");
      await b.query("set application_name='notice-racer'");
      await insert(a, notice(e, first));
      let settled = false;
      const waiting = insert(
        b,
        notice(e, first === "old" ? "new" : "old"),
      ).then((r) => {
        settled = true;
        return r;
      });
      for (let i = 0; i < 50; i++) {
        if (
          (
            await db.query(
              "select 1 from pg_stat_activity where application_name='notice-racer' and wait_event_type='Lock'",
            )
          ).rowCount
        )
          break;
        if (i === 49) throw Error("No real blocking contender");
        await new Promise((r) => setTimeout(r, 20));
      }
      assert(!settled);
      await a.query("commit");
      assert((await waiting).duplicate);
      assert.equal(await count(e), "1");
    } finally {
      await a.end();
      await b.end();
    }
  }
  passed.push("two_real_sessions_old_new_both_orders_block_and_commit_once");
  const rolled = await transition();
  const a = new Client(config),
    b = new Client(config);
  await a.connect();
  await b.connect();
  try {
    await a.query("begin");
    await insert(a, notice(rolled, "old"));
    const pending = insert(b, notice(rolled));
    await a.query("rollback");
    assert((await pending).inserted);
    assert.equal(await count(rolled), "1");
  } finally {
    await a.end();
    await b.end();
  }
  passed.push("rolled_back_first_producer_does_not_lose_notice");
  await db.query(
    "grant insert,select on public.outbox_messages to service_role",
  );
  await db.query("set role service_role");
  assert(
    (await insert(db, notice(fail, "new", "service-role@example.test")))
      .inserted,
  );
  await db.query("reset role");
  passed.push("actual_service_role_can_queue_through_guard");
  await db.query(
    "grant insert on public.outbox_messages to anon, authenticated",
  );
  for (const role of ["anon", "authenticated"]) {
    await db.query("set role " + role);
    await assert.rejects(
      () => insert(db, notice(fail)),
      /permission denied for lesson change notification/,
    );
    await db.query("reset role");
  }
  passed.push("public_insert_grants_cannot_probe_private_effects_before_rls");
  await db.query("set role authenticated");
  await assert.rejects(
    () =>
      db.query("select lesson_ops.notice_effect(null::public.outbox_messages)"),
    /permission denied/,
  );
  await db.query("reset role");
  passed.push("private_functions_not_callable_by_portal_roles");
  const result = {
    status: "PASS",
    checkedAt: new Date().toISOString(),
    postgres: 17,
    migrations: 60,
    localOnly: true,
    scenarios: passed,
    productionAndHostedCalls: 0,
    providers: 0,
    messagesDelivered: 0,
    migration: files.at(-1),
    identityMigration: files.at(-2),
    migrationSha256LF: createHash("sha256")
      .update(
        fs
          .readFileSync(join("supabase/migrations", files.at(-1)), "utf8")
          .replace(/\r\n/g, "\n"),
      )
      .digest("hex"),
  };
  fs.writeFileSync(
    "docs/waves-one-two-notice-cutover-validation.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db?.end();
  bin(pg_ctl, ["-D", data, "-m", "fast", "-w", "stop"]);
}
