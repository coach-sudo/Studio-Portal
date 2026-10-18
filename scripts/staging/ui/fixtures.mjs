import assert from "node:assert/strict";
import {
  plan,
  ids,
  authIds,
  students,
  sha,
  identifier,
  assertUndelivered,
} from "./policy.mjs";
export async function seed(e) {
  for (const [role, account] of Object.entries(plan.accounts)) {
    if (e.journal.find("auth-created", role)) {
      await e.attest();
      e.read();
      await e.auth.verify?.(role, account);
      continue;
    }
    assert(
      !e.journal.find("auth-intent", role),
      "Ambiguous Auth provisioning; inspect exact ID, do not retry",
    );
    await e.attest();
    e.verify(await e.capture(), false);
    e.journal.reserve("auth-admin", 8);
    e.journal.append({ type: "auth-intent", name: role, id: account.id });
    await e.auth.create(role, account);
    e.journal.append({ type: "auth-created", name: role, id: account.id });
  }
  await e.sql("setup.business", async () => {
    for (const role of ["coach", "student", "guardian"])
      await e.db.query(
        "insert into public.memberships(id,studio_id,user_id,role,display_name) values($1,$2,$3,$4,$5)",
        [
          ids["membership-" + role],
          plan.target.studio,
          authIds[role],
          role,
          plan.runId + " " + role,
        ],
      );
    for (const [i, id] of students.entries())
      await e.db.query(
        "insert into public.students(id,studio_id,user_id,full_name,email,portal_enabled,notification_preferences) values($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          plan.target.studio,
          i === 0 ? authIds.student : null,
          plan.runId + " Student " + i,
          i === 0
            ? plan.accounts.student.email
            : plan.runId + "-control@coachd-staging.example.test",
          i === 0,
          {
            email: false,
            lessonReminders: false,
            lessonChanges: false,
            bookingConfirmations: false,
          },
        ],
      );
    await e.db.query(
      'insert into public.linked_contacts(id,studio_id,student_id,user_id,full_name,email,relationship_type,relationship_label,portal_enabled,can_receive_notifications,can_view_finance,can_view_work,can_view_schedule,can_manage_profile,can_manage_lessons,notification_preferences) values($1,$2,$3,$4,$5,$6,\'guardian\',\'Synthetic guardian\',true,false,true,true,true,false,false,\'{"lessonReminders":false,"scheduleChanges":false,"lessonContent":false,"assignments":false,"packageBalance":false,"payments":false,"accountAccess":false}\'::jsonb)',
      [
        ids.contact,
        plan.target.studio,
        ids.student,
        authIds.guardian,
        plan.runId + " Guardian",
        plan.accounts.guardian.email,
      ],
    );
    // The existing trigger owns relationship creation; capture its actual UUID.
    for (const id of students)
      await e.db.query(
        "insert into public.student_credit_accounts(student_id,auto_apply) values($1,false)",
        [id],
      );
    await e.db.query(
      "insert into public.packages(id,student_id,name,currency,price_minor) values($1,$2,'Studio lesson credits','USD',0)",
      [ids.package, ids.student],
    );
    await e.db.query(
      "insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor) values($1,$2,$3,$3,'private',60,0)",
      [ids.service, plan.target.studio, plan.runId],
    );
    for (const l of plan.fixtureContent.lessons)
      await e.db.query(
        "insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,price_minor,paid_minor,payment_status,source_provider) values($1,$2,$3,$4,$5,$6,$7,'in_person',$8,0,0,'due','studio')",
        [
          l.id,
          plan.target.studio,
          ids.student,
          l.topic,
          l.startsAt,
          l.endsAt,
          l.status,
          l.locationLabel,
        ],
      );
    return { seededLessons: 12, students };
  });
}
export async function processJob(e, jobId) {
  const allowed = e.jobs.get(jobId);
  assert(allowed, "Unknown bulk job");
  return e.sql("process." + jobId, async () => {
    const job = (
      await e.db.query(
        "select * from lesson_ops.lesson_bulk_jobs where id=$1 for update",
        [jobId],
      )
    ).rows[0];
    assert.equal(job.actor_id, authIds.coach);
    assert.equal(job.studio_id, plan.target.studio);
    assert.equal(job.state, "running");
    const items = (
      await e.db.query(
        "select * from lesson_ops.lesson_bulk_items where job_id=$1 order by ordinal",
        [jobId],
      )
    ).rows;
    assert(items.length <= 13);
    assert(items.every((i) => allowed.ids.includes(i.lesson_id)));
    assert.equal(items.length, allowed.ids.length);
    e.journal.reserve("sql", 60);
    const claimed = (
      await e.db.query("select public.claim_lesson_bulk_items($1,$2) value", [
        13,
        jobId,
      ])
    ).rows[0].value;
    assert(claimed.length <= items.length);
    for (const c of claimed) {
      assert.equal(c.job_id, jobId);
      const i = items.find((i) => i.id === c.id);
      assert(i && allowed.ids.includes(i.lesson_id));
      e.journal.append({
        type: "bulk-lease",
        name: c.id,
        jobId,
        token: c.claim_token,
      });
      e.journal.reserve("sql", 60);
      await e.db.query("select public.process_lesson_bulk_item($1,$2)", [
        c.id,
        c.claim_token,
      ]);
    }
    return { jobId, processed: claimed.length };
  });
}
export async function cleanup(e) {
  // No ledger, package, lesson, participant, note, audit, receipt, deletion
  // snapshot or bulk-history deletion is part of this cleanup policy.
  await e.sql(
    "cleanup.terminal",
    async () => {
      for (const id of students) {
        await e.db.query(
          "update public.student_credit_accounts set auto_apply=false where student_id=$1",
          [id],
        );
        // Use the authoritative occurrence command and retained-credit policy;
        // never update lifecycle columns directly or delete financial history.
        const scheduled = (
          await e.db.query(
            "select id,version from public.lessons where student_id=$1 and status='scheduled' order by id",
            [id],
          )
        ).rows;
        for (const l of scheduled) {
          const value = {
            lessonId: l.id,
            action: "cancel",
            scope: "occurrence",
            useCredit: true,
            wholeClass: false,
            reason: plan.runId + " cleanup",
          };
          e.journal.reserve("sql", 60);
          const preview = (
            await e.db.query(
              "select public.preview_lesson_occurrence_change($1,$2::jsonb) value",
              [authIds.coach, JSON.stringify(value)],
            )
          ).rows[0].value;
          e.journal.reserve("sql", 60);
          e.journal.append({
            type: "rpc-intent",
            name: "cleanup.cancel." + l.id,
            key: plan.runId + ":cleanup:" + l.id,
            occurrenceKey: `occurrence:${l.id}:${l.version}:cancel`,
          });
          await e.db.query(
            "select public.execute_lesson_occurrence_change($1,$2,$3::jsonb)",
            [
              authIds.coach,
              plan.runId + ":cleanup:" + l.id,
              JSON.stringify({ ...value, reviewToken: preview.reviewToken }),
            ],
          );
        }
        await e.db.query(
          "update public.students set status='inactive',deleted_at=coalesce(deleted_at,now()),portal_enabled=false,user_id=null where id=$1 and studio_id=$2",
          [id, plan.target.studio],
        );
      }
      return { retainedStudents: students };
    },
    { cleanup: true },
  );
  for (const table of [
    "public.outbox_messages",
    "lesson_ops.effects",
    "public.calendar_projections",
    "credit_internal.credit_coverage_jobs",
    "public.student_relationships",
    "public.linked_contacts",
    "public.memberships",
    "public.booking_services",
  ]) {
    await e.sql(
      "cleanup." + table,
      async () => {
        const rows = e.ownRows(table);
        for (const row of rows) {
          if (
            [
              "public.outbox_messages",
              "public.calendar_projections",
              "lesson_ops.effects",
            ].includes(table)
          )
            assertUndelivered(table, row);
          if (table === "credit_internal.credit_coverage_jobs")
            assert.equal(row.attempts, 0, "Coverage job already attempted");
          const key = row.id
            ? "id"
            : table === "public.calendar_projections"
              ? "lesson_id"
              : "student_id";
          const result = await e.db.query(
            `delete from ${identifier(table)} t where ${key}=$1 and to_jsonb(t)=$2::jsonb`,
            [row[key], JSON.stringify(row)],
          );
          assert.equal(result.rowCount, 1, "Cleanup preimage conflict");
        }
        return { table, removed: rows.length };
      },
      { cleanup: true },
    );
  }
  for (const role of ["student", "guardian", "unrelated", "coach"]) {
    if (e.journal.find("auth-cleaned", role)) continue;
    assert(
      !e.journal.find("auth-cleanup-intent", role),
      "Ambiguous Auth cleanup requires exact-ID readback",
    );
    await e.attest();
    e.verify(await e.capture(), false);
    e.journal.reserve("auth-admin", 8);
    e.journal.append({
      type: "auth-cleanup-intent",
      name: role,
      id: authIds[role],
    });
    await e.auth.remove(role, authIds[role]);
    e.verify(await e.capture(), false);
    e.journal.append({
      type: "auth-cleaned",
      name: role,
      retained: role === "coach",
    });
  }
  return verifyCleanup(e);
}
export async function verifyCleanup(e) {
  const all = await e.capture();
  e.verify(all, false);
  for (const table of [
    "public.outbox_messages",
    "public.calendar_projections",
    "lesson_ops.effects",
    "credit_internal.credit_coverage_jobs",
    "public.memberships",
    "public.linked_contacts",
    "public.student_relationships",
  ])
    assert.equal(
      e.ownRows(table).length,
      0,
      "Runnable/temporary records remain: " + table,
    );
  for (const r of e.ownRows("public.students"))
    assert(
      r.deleted_at &&
        r.status === "inactive" &&
        !r.portal_enabled &&
        !r.user_id,
    );
  for (const r of e.ownRows("public.lessons"))
    assert(!["scheduled"].includes(r.status), "Active lesson remains");
  for (const r of e.ownRows("public.student_credit_accounts"))
    assert.equal(r.auto_apply, false);
  for (const item of e.ownRows("lesson_ops.lesson_bulk_items")) {
    assert(!item.claim_token && !item.claim_until, "Active lease retained");
    const j = e
      .ownRows("lesson_ops.lesson_bulk_jobs")
      .find((j) => j.id === item.job_id);
    assert(
      !(
        j.state === "running" &&
        ["pending", "processing", "failed"].includes(item.status)
      ),
      "Runnable bulk item",
    );
  }
  const retained = Object.fromEntries(
    Object.keys(all)
      .map((t) => [
        t,
        e
          .ownRows(t)
          .map((r) => ({ id: r.id || r.student_id || r.key, sha256: sha(r) })),
      ])
      .filter(([, rows]) => rows.length),
  );
  const proof = {
    baselineUnchanged: true,
    tables: 76,
    retained,
    authRetained: authIds.coach,
  };
  e.journal.append({ type: "cleanup-proof", name: "final", value: proof });
  return proof;
}
