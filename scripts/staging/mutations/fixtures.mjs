import assert from "node:assert/strict";
import {
  ids,
  students,
  target,
  email,
  users,
  retained,
  assertUnattempted,
} from "./policy.mjs";
import { identifier } from "./engine.mjs";

export const seededLessons = [
  "lesson-return",
  "lesson-reuse",
  "lesson-paid",
  "lesson-pending-invoice",
  "lesson-provider",
  "lesson-delete",
  "lesson-protected-note",
  "lesson-archive",
  "lesson-void",
  "series-first",
  "series-next",
  "class",
  "lesson-stale",
];
export async function seed(e) {
  await e.auth.prepare(e);
  return e.op("seed.business", async () => {
    const saved = e.journal.find("anchor", "time");
    const anchor =
      saved?.value ||
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) +
        "T16:00:00.000Z";
    if (!saved)
      e.journal.append({ type: "anchor", name: "time", value: anchor });
    const at = (day) =>
      new Date(Date.parse(anchor) + day * 86400000).toISOString();
    for (const [i, role] of ["coach", "student-user", "guardian"].entries())
      await e.db.query(
        "insert into public.memberships(id,studio_id,user_id,role,display_name) values($1,$2,$3,$4,$5)",
        [
          ids[
            ["membership-coach", "membership-student", "membership-guardian"][i]
          ],
          target.studio,
          ids[role],
          role === "student-user" ? "student" : role,
          target.run + " " + role,
        ],
      );
    for (const [n, sid] of students.entries())
      await e.db.query(
        "insert into public.students(id,studio_id,user_id,full_name,email,portal_enabled) values($1,$2,$3,$4,$5,true)",
        [
          sid,
          target.studio,
          n === 0 ? ids["student-user"] : null,
          target.run + " Student " + n,
          email(n === 0 ? "student-user" : "other-student"),
        ],
      );
    await e.db.query(
      "insert into public.linked_contacts(id,studio_id,student_id,user_id,full_name,email,portal_enabled,can_view_finance,can_view_work,can_view_schedule) values($1,$2,$3,$4,$5,$6,true,true,true,true)",
      [
        ids["guardian-contact"],
        target.studio,
        ids.student,
        ids.guardian,
        target.run + " Guardian",
        email("guardian"),
      ],
    );
    for (const sid of students)
      await e.db.query(
        "insert into public.student_credit_accounts(student_id,auto_apply) values($1,false)",
        [sid],
      );
    await e.db.query(
      "insert into public.packages(id,student_id,name,expires_at,currency) values($1,$2,$3,$4,'USD')",
      [ids.package, ids.student, target.run + " credits", at(60)],
    );
    await e.db.query(
      "insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor) values($1,$2,$3,$3,'private',60,0)",
      [ids.service, target.studio, target.run],
    );
    await e.db.query(
      "insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor) values($1,$2,$3,$3,'group_class',60,0)",
      [ids["class-service"], target.studio, target.run + "-class"],
    );
    for (const [i, label] of seededLessons.entries()) {
      const first = i < 2;
      await e.db.query(
        "insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,source_provider) values($1,$2,$3,$4,$5,$6,$7,'in_person','Synthetic studio',$8)",
        [
          ids[label],
          target.studio,
          first ? ids.student : ids["other-student"],
          target.run + " " + label,
          at(first ? 20 + i * 2 : 100 + i * 2),
          at((first ? 20 + i * 2 : 100 + i * 2) + 1 / 24),
          first ||
          ["lesson-archive", "lesson-void", "lesson-stale"].includes(label)
            ? "cancelled"
            : "scheduled",
          label === "lesson-provider" ? "acuity" : "studio",
        ],
      );
    }
    const first = await e.row("public.lessons", ids["series-first"]);
    await e.db.query(
      "insert into public.recurring_series(id,studio_id,service_id,student_id,kind,cadence,starts_on,occurrence_count,payment_policy) values($1,$2,$3,$4,'fixed','weekly',$5,2,'pay_later')",
      [
        ids.series,
        target.studio,
        ids.service,
        ids["other-student"],
        first.starts_at,
      ],
    );
    await e.db.query(
      "update public.lessons set series_id=$1 where id=any($2::uuid[])",
      [ids.series, [ids["series-first"], ids["series-next"]]],
    );
    await e.db.query(
      "update public.lessons set starts_at=$1::timestamptz+interval '7 days',ends_at=$1::timestamptz+interval '7 days 1 hour' where id=$2",
      [first.starts_at, ids["series-next"]],
    );
    for (const [label, paid, lesson] of [
      ["shared-booking", 0, "series-first"],
      ["shared-prepaid", 10000, "lesson-paid"],
    ]) {
      const row = await e.row("public.lessons", ids[lesson]);
      await e.db.query(
        "insert into public.bookings(id,studio_id,student_id,service_id,reference,guest_name,guest_email,starts_at,ends_at,timezone,location,status,payment_policy,payment_status,total_minor,paid_minor,policy_snapshot,manage_token_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'America/New_York','in_person','confirmed',$10,$11,$12,$12,'{}',$13)",
        [
          ids[label],
          target.studio,
          ids["other-student"],
          ids.service,
          target.run + "-" + label,
          target.run,
          email("other-student"),
          row.starts_at,
          row.ends_at,
          paid ? "pay_now" : "pay_later",
          paid ? "paid" : "due",
          paid,
          target.run + "-" + label,
        ],
      );
    }
    for (const [lesson, booking] of [
      ["series-first", "shared-booking"],
      ["series-next", "shared-booking"],
      ["lesson-paid", "shared-prepaid"],
      ["lesson-pending-invoice", "shared-prepaid"],
    ])
      await e.db.query(
        "insert into public.lesson_participants(lesson_id,student_id,booking_id,display_name,email) values($1,$2,$3,$4,$5)",
        [
          ids[lesson],
          ids["other-student"],
          ids[booking],
          target.run,
          email("other-student"),
        ],
      );
    await e.db.query("update public.bookings set series_id=$1 where id=$2", [
      ids.series,
      ids["shared-booking"],
    ]);
    for (const label of ["series-first", "series-next"]) {
      await e.db.query(
        "insert into public.calendar_projections(lesson_id,status,projected_version) values($1,'queued',0)",
        [ids[label]],
      );
      await e.db.query(
        "insert into public.outbox_messages(studio_id,student_id,lesson_id,channel,recipient,subject,body,status,recipient_intent,dedupe_key,send_at) values($1,$2,$3,'email',$4,$5,$5,'queued','lesson_reminder',$6,(select starts_at-interval '1 day' from public.lessons where id=$3))",
        [
          target.studio,
          ids["other-student"],
          ids[label],
          email("other-student"),
          target.run,
          target.run + ":reminder:" + label,
        ],
      );
    }
    const cls = await e.row("public.lessons", ids.class);
    await e.db.query(
      "insert into public.service_offerings(id,studio_id,service_id,title,starts_at,ends_at,enrollment_closes_at,capacity,lesson_ids) values($1,$2,$3,$4,$5,$6,$5,2,$7)",
      [
        ids.offering,
        target.studio,
        ids["class-service"],
        target.run + " Class",
        cls.starts_at,
        cls.ends_at,
        [ids.class],
      ],
    );
    await e.db.query(
      "update public.lessons set offering_id=$1,capacity=2 where id=$2",
      [ids.offering, ids.class],
    );
    for (const [i, sid] of students.entries())
      await e.db.query(
        "insert into public.lesson_participants(lesson_id,student_id,display_name,email) values($1,$2,$3,$4)",
        [
          ids.class,
          sid,
          target.run,
          email(i ? "other-student" : "student-user"),
        ],
      );
    await e.db.query(
      "insert into public.notes(id,lesson_id,student_id,title,body) values($1,$2,$3,$4,'Synthetic authored content; preserve until reviewed cleanup')",
      [
        ids.note,
        ids["lesson-protected-note"],
        ids["other-student"],
        target.run,
      ],
    );
    await e.db.query(
      "insert into public.studio_invoices(id,studio_id,student_id,number,status,currency,issue_date,due_date,branding,recipient,items,total_minor,checkout_session_id) values($1,$2,$3,$4,'open','USD',current_date,current_date,'{}','{}',$5,0,$6)",
      [
        ids.invoice,
        target.studio,
        ids["other-student"],
        target.run,
        JSON.stringify([
          {
            lessonId: ids["lesson-pending-invoice"],
            description: target.run,
            quantity: 1,
            unitPriceMinor: 0,
            totalMinor: 0,
          },
        ]),
        "synthetic-" + target.run,
      ],
    );
    return { anchor, seededLessons: seededLessons.length };
  });
}

export async function cleanup(e) {
  if (!e.journal.find("committed", "seed.business")) {
    e.verify(await e.snapshot(), false);
    assert(
      Object.values(e.known).every((rows) => rows.size === 0),
      "Uncommitted provisioning has business changes",
    );
    for (const role of users) await e.auth.cleanup(role, e);
    e.verify(await e.snapshot(), false);
    return { partialProvisioning: true, retainedAuth: ids.coach };
  }
  // Retained private receipts and audit FK references require terminal students
  // and the coach Auth identity. No audit/snapshot cleanup bypass RPC is used.
  const order = [
    "public.outbox_messages",
    "lesson_ops.effects",
    "public.notes",
    "public.studio_invoices",
    "public.lesson_participants",
    "public.calendar_projections",
    "public.recommendations",
    "lesson_ops.lesson_record_state",
    "public.package_credit_entries",
    "public.lessons",
    "public.bookings",
    "public.recurring_series",
    "public.service_offerings",
    "public.packages",
    "credit_internal.credit_coverage_jobs",
    "public.student_relationships",
    "public.linked_contacts",
    "public.memberships",
    "public.booking_services",
  ];
  for (const table of order)
    await e.op(
      "cleanup." + table.replaceAll(".", "-"),
      async () => {
        assert(!table.includes("snapshot") && !table.includes("audit"));
        const rows = [...e.known[table].values()].map((x) => x.row);
        for (const row of rows) {
          if (
            ["public.calendar_projections", "public.outbox_messages"].includes(
              table,
            )
          )
            assertUnattempted(table, row);
          const key =
            table === "lesson_ops.lesson_record_state"
              ? "lesson_id"
              : table === "credit_internal.credit_coverage_jobs"
                ? "student_id"
                : "id";
          // Exact row preimage and PK; never a studio-wide or prefix-only delete.
          const result = await e.db.query(
            `delete from ${identifier(table)} t where ${key}=$1 and to_jsonb(t)=$2::jsonb`,
            [row[key], JSON.stringify(row)],
          );
          assert.equal(
            result.rowCount,
            1,
            `Cleanup preimage conflict: ${table}`,
          );
        }
        return { table, removed: rows.length };
      },
      { cleanup: true },
    );
  await e.op(
    "cleanup.terminal-students",
    async () => {
      for (const id of students)
        await e.db.query(
          "update public.students set portal_enabled=false,user_id=null,status='inactive',deleted_at=coalesce(deleted_at,now()) where id=$1 and studio_id=$2",
          [id, target.studio],
        );
      for (const id of students)
        await e.db.query(
          "update public.student_credit_accounts set auto_apply=false where student_id=$1",
          [id],
        );
      return { retainedStudents: students };
    },
    { cleanup: true },
  );
  for (const role of users) await e.auth.cleanup(role, e);
  e.verify(await e.snapshot(), false);
  for (const table of [
    "public.outbox_messages",
    "public.calendar_projections",
    "lesson_ops.effects",
    "credit_internal.credit_coverage_jobs",
    "public.package_credit_entries",
    "public.lessons",
    "public.memberships",
    "public.linked_contacts",
    "public.student_relationships",
  ])
    assert.equal(e.known[table].size, 0, `Cleanup incomplete: ${table}`);
  for (const { row } of e.known["lesson_ops.lesson_bulk_jobs"].values())
    if (row.state === "running") {
      for (const { row: item } of e.known[
        "lesson_ops.lesson_bulk_items"
      ].values())
        if (item.job_id === row.id)
          assert(
            !["pending", "processing", "failed"].includes(item.status),
            "Deliverable bulk job retained",
          );
    }
  for (const { row } of e.known["lesson_ops.lesson_bulk_items"].values())
    assert(row.status !== "processing", "Active bulk lease retained");
  return {
    retainedTables: [...retained],
    retainedAuth: ids.coach,
    retainedStudents: students,
  };
}
