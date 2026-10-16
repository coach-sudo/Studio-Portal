import assert from "node:assert/strict";
import { target, ids, email } from "./policy.mjs";
const key = (name) => target.run + ":" + name;
const at = (e, day) =>
  new Date(
    Date.parse(e.journal.find("committed", "seed.business").result.anchor) +
      day * 86400000,
  ).toISOString();
const saved = (e, name) => e.journal.find("committed", name).result;
const lesson = (e, label) => e.row("public.lessons", ids[label] || label);
const query = async (e, sql, args = []) => (await e.db.query(sql, args)).rows;
const summary = async (e) =>
  (
    await query(e, "select public.student_credit_summary($1) v", [ids.student])
  )[0].v;
const nets = async (e, lid) =>
  (
    await query(
      e,
      "select coalesce(sum(quantity),0)::integer v from public.package_credit_entries where lesson_id=$1",
      [lid],
    )
  )[0].v;
async function change(e, name, lid, action, more = {}) {
  const r = await e.call(
    name + ".preview",
    "preview_lesson_occurrence_change",
    async () => [
      ids.coach,
      {
        lessonId: lid,
        action,
        scope: "occurrence",
        reason: target.run,
        ...more,
      },
    ],
  );
  return e.call(
    name + ".execute",
    "execute_lesson_occurrence_change",
    async () => [
      ids.coach,
      key(name),
      {
        lessonId: lid,
        action,
        scope: "occurrence",
        reason: target.run,
        ...more,
        reviewToken: r.reviewToken,
      },
    ],
  );
}
async function preview(e, name, operation, selected, extra = {}) {
  return e.call(name, "preview_lesson_bulk", async () => [
    ids.coach,
    target.studio,
    key(name),
    {
      operation,
      selectedIds: selected,
      reason: target.run,
      scope: "selected",
      ...extra,
    },
  ]);
}
async function accept(e, name, r, executionName = name) {
  return e.call(name, "execute_lesson_bulk", async () => [
    ids.coach,
    r.jobId,
    r.reviewToken,
    key(executionName),
  ]);
}
async function work(e, name, r) {
  const claims = await e.call(
    name + ".claim",
    "claim_lesson_bulk_items",
    async () => [20, r.jobId],
  );
  const result = [];
  for (const [i, c] of claims.entries())
    result.push(
      await e.call(
        name + ".process-" + i,
        "process_lesson_bulk_item",
        async () => [c.id, c.claim_token],
      ),
    );
  return result;
}
async function batch(e, name, operation, selected) {
  const r = await preview(e, name + ".preview", operation, selected);
  await accept(e, name + ".accept", r);
  return work(e, name, r);
}
export const cases = {
  async H01(e) {
    const value = {
      quantity: 4,
      kind: "adjustment",
      packageId: ids.package,
      reason: target.run,
    };
    const a = await e.call(
      "H01.grant",
      "command_grant_student_credits",
      async () => [ids.student, key("grant"), value, ids.coach],
    );
    const b = await e.call(
      "H01.repeat",
      "command_grant_student_credits",
      async () => [ids.student, key("grant"), value, ids.coach],
    );
    assert.equal(a.duplicate, false);
    assert.equal(b.duplicate, true);
    assert.equal(a.entry.id, b.entry.id);
    assert.equal((await summary(e)).remaining, 4);
    await e.assert(
      "select count(*)::integer v from credit_internal.credit_command_receipts where student_id=$1",
      [ids.student],
      1,
    );
  },
  async H02(e) {
    await e.call("H02.enable", "command_student_credit_settings", async () => [
      ids.student,
      "set_auto",
      { enabled: true },
      (await summary(e)).version,
      key("enable"),
      ids.coach,
    ]);
    for (let i = 0; i < 3; i++)
      await e.call("H02.create-" + i, "command_create_lesson", async () => [
        target.studio,
        ids.student,
        target.run + " Created " + i,
        at(e, 10 + i),
        at(e, 10 + i + 1 / 24),
        "in_person",
        "Synthetic studio",
        target.run + " Student 0",
        email("student-user"),
        "none",
        1,
        "America/New_York",
      ]);
    const s = await summary(e);
    assert.equal(s.remaining, 4);
    assert.equal(s.reserved, 3);
    assert.equal(s.available, 1);
  },
  async H03(e) {
    for (let i = 0; i < 2; i++) {
      const r = await e.call(
        "H03.apply-" + i,
        "command_student_credit_settings",
        async () => [
          ids.student,
          "apply_upcoming",
          {},
          (await summary(e)).version,
          key("apply-repeat"),
          ids.coach,
        ],
      );
      assert.equal(r.applied, 0);
      assert.equal(r.alreadyCovered, 3);
    }
    // Dropped transport response is tested by the transaction/journal fault hook;
    // this second actual request verifies the application's stable replay receipt.
    await e.assert(
      "select count(*)::integer v from public.package_credit_entries where package_id=$1 and quantity<0",
      [ids.package],
      3,
    );
  },
  async H04(e) {
    const lid = saved(e, "H02.create-0").lesson.id;
    const a = await e.call(
      "H04.complete",
      "command_complete_lesson",
      async () => [
        lid,
        (await lesson(e, lid)).version,
        target.run,
        key("complete"),
        target.run,
      ],
    );
    const b = await e.call(
      "H04.repeat",
      "command_complete_lesson",
      async () => [
        lid,
        a.resource.version - 1,
        target.run,
        key("complete"),
        target.run,
      ],
    );
    assert.deepEqual(a, b);
    assert.equal(await nets(e, lid), -1);
  },
  async H05(e) {
    await e.op("H05.activate-return", async () => {
      await e.db.query(
        "update public.lessons set status='scheduled',version=version+1 where id=$1",
        [ids["lesson-return"]],
      );
      return true;
    });
    await e.call(
      "H05.reserve-return",
      "reserve_student_upcoming_credits",
      async () => [ids.student],
    );
    await e.op("H05.activate-reuse", async () => {
      await e.db.query(
        "update public.lessons set status='scheduled',version=version+1 where id=$1",
        [ids["lesson-reuse"]],
      );
      return true;
    });
    if (!e.journal.find("committed", "H05.cancel.execute"))
      assert.equal(await nets(e, ids["lesson-reuse"]), 0);
    await change(e, "H05.cancel", ids["lesson-return"], "cancel", {
      useCredit: false,
    });
    assert.equal(await nets(e, ids["lesson-return"]), 0);
    assert.equal(await nets(e, ids["lesson-reuse"]), -1);
    assert.equal(await nets(e, saved(e, "H02.create-1").lesson.id), -1);
  },
  async H06(e) {
    const lid = ids["lesson-reuse"];
    await change(e, "H06.valid", lid, "reschedule", {
      startsAt: at(e, 23),
      endsAt: at(e, 23 + 1 / 24),
    });
    assert.equal(await nets(e, lid), -1);
    const r = await e.call(
      "H06.expiry-preview",
      "preview_lesson_occurrence_change",
      async () => [
        ids.coach,
        {
          lessonId: lid,
          action: "reschedule",
          scope: "occurrence",
          reason: target.run,
          startsAt: at(e, 90),
          endsAt: at(e, 90 + 1 / 24),
        },
      ],
    );
    assert.equal(r.items[0].eligible, false);
    assert.equal(r.items[0].reasonCode, "reserved_credit_expires");
    await e.denied(
      "H06.expiry-execute",
      "execute_lesson_occurrence_change",
      async () => [
        ids.coach,
        key("H06-expiry"),
        {
          lessonId: lid,
          action: "reschedule",
          scope: "occurrence",
          reason: target.run,
          startsAt: at(e, 90),
          endsAt: at(e, 90 + 1 / 24),
          reviewToken: r.reviewToken,
        },
      ],
      /REVIEW_REQUIRED/,
    );
    assert.equal(await nets(e, lid), -1);
  },
  async H07(e) {
    await e.call(
      "H07.extra-credit",
      "command_grant_student_credits",
      async () => [
        ids.student,
        key("recurring-grant"),
        {
          quantity: 2,
          kind: "adjustment",
          packageId: ids.package,
          reason: target.run,
        },
        ids.coach,
      ],
    );
    const lid = saved(e, "H02.create-1").lesson.id;
    const r = await e.call(
      "H07.recurring",
      "command_make_lesson_recurring",
      async () => [
        lid,
        (await lesson(e, lid)).version,
        "weekly",
        3,
        "America/New_York",
      ],
    );
    const seriesId = r.series?.id || r.seriesId;
    const rows = await query(
      e,
      "select id from public.lessons where series_id=$1",
      [seriesId],
    );
    assert.equal(rows.length, 3);
    for (const row of rows) assert.equal(await nets(e, row.id), -1);
  },
  async H08(e) {
    const sibling = await lesson(e, "series-next");
    const reminder = (
      await query(
        e,
        "select to_jsonb(m) v from public.outbox_messages m where lesson_id=$1",
        [ids["series-next"]],
      )
    )[0].v;
    const projection = (
      await query(
        e,
        "select to_jsonb(p) v from public.calendar_projections p where lesson_id=$1",
        [ids["series-next"]],
      )
    )[0].v;
    await change(e, "H08.cancel", ids["series-first"], "cancel", {
      useCredit: false,
    });
    assert.deepEqual(await lesson(e, "series-next"), sibling);
    assert.equal(
      (await e.row("public.bookings", ids["shared-booking"])).status,
      "confirmed",
    );
    assert.equal(
      (await e.row("public.recurring_series", ids.series)).status,
      "active",
    );
    assert.deepEqual(
      (
        await query(
          e,
          "select to_jsonb(m) v from public.outbox_messages m where lesson_id=$1",
          [ids["series-next"]],
        )
      )[0].v,
      reminder,
    );
    assert.deepEqual(
      (
        await query(
          e,
          "select to_jsonb(p) v from public.calendar_projections p where lesson_id=$1",
          [ids["series-next"]],
        )
      )[0].v,
      projection,
    );
    await e.assert(
      "select status::text v from public.outbox_messages where lesson_id=$1",
      [ids["series-first"]],
      "cancelled",
    );
    await e.assert(
      "select count(*)::integer v from lesson_ops.effects where lesson_id=$1",
      [ids["series-next"]],
      0,
    );
  },
  async H09(e) {
    const a = await e.call(
      "H09.prepaid",
      "preview_lesson_occurrence_change",
      async () => [
        ids.coach,
        {
          lessonId: ids["lesson-paid"],
          action: "cancel",
          scope: "occurrence",
          reason: target.run,
        },
      ],
    );
    assert(a.items.every((i) => !i.eligible));
    assert.equal(a.items[0].reasonCode, "shared_prepaid_review_required");
    const b = await preview(e, "H09.class", "cancel", [ids.class], {
      studentContextId: ids.student,
    });
    assert.equal(b.eligible, 0);
    assert.equal(b.blocked, 1);
    assert.equal(
      (await e.row("public.bookings", ids["shared-prepaid"])).paid_minor,
      10000,
    );
    await e.assert(
      "select count(*)::integer v from public.lesson_participants where lesson_id=$1",
      [ids.class],
      2,
    );
  },
  async H10(e) {
    const r = await preview(e, "H10.review", "delete", [
      ids["lesson-pending-invoice"],
      ids["lesson-provider"],
      ids["lesson-protected-note"],
      ids["lesson-delete"],
    ]);
    assert.equal(r.count, 4);
    assert.equal(r.eligible, 1);
    assert.equal(r.blocked, 3);
    const p = await e.call("H10.progress", "lesson_bulk_progress", async () => [
      ids.coach,
      r.jobId,
      0,
      20,
    ]);
    assert.equal(p.items.filter((i) => i.status === "blocked").length, 3);
    assert.equal(
      p.items.find((i) => i.lessonId === ids["lesson-provider"]).reasonCode,
      "provider_history",
    );
    for (const [label, table] of [
      ["lesson-pending-invoice", "public.studio_invoices"],
      ["lesson-protected-note", "public.notes"],
    ]) {
      const item = p.items.find((i) => i.lessonId === ids[label]);
      assert.equal(item.status, "blocked");
      assert(
        Object.keys(item.assessment.dependencies).some((k) =>
          k.startsWith(table + "."),
        ),
        "Missing frozen dependency",
      );
    }
  },
  async H11(e) {
    const r = saved(e, "H10.review");
    await accept(e, "H11.accept", r);
    const duplicate = await accept(e, "H11.repeat", r, "H11.accept");
    assert.equal(duplicate.duplicate, true);
    const result = await work(e, "H11", r);
    assert.equal(result.filter((x) => x.status === "succeeded").length, 1);
    await e.assert(
      "select count(*)::integer v from public.lessons where id=$1",
      [ids["lesson-delete"]],
      0,
    );
    await e.assert(
      "select count(*)::integer v from lesson_ops.lesson_deletion_snapshots where lesson_id=$1",
      [ids["lesson-delete"]],
      1,
    );
    assert(await lesson(e, "lesson-protected-note"));
    assert(await lesson(e, "lesson-pending-invoice"));
  },
  async H12(e) {
    for (const operation of ["archive", "restore"])
      assert.equal(
        (
          await batch(e, "H12." + operation, operation, [ids["lesson-archive"]])
        )[0].status,
        "succeeded",
      );
    assert.equal(
      (await batch(e, "H12.void", "void", [ids["lesson-void"]]))[0].status,
      "succeeded",
    );
    assert.equal((await lesson(e, "lesson-void")).status, "cancelled");
    await e.assert(
      "select count(*)::integer v from lesson_ops.effects where lesson_id=any($1::uuid[])",
      [[ids["lesson-archive"], ids["lesson-void"]]],
      0,
    );
  },
  async H13(e) {
    const r = await preview(e, "H13.review", "archive", [
      ids["lesson-archive"],
      ids["lesson-stale"],
    ]);
    await e.op("H13.stale", async () => {
      await e.db.query(
        "update public.lessons set version=version+1 where id=$1",
        [ids["lesson-stale"]],
      );
      return true;
    });
    await accept(e, "H13.accept", r);
    const result = await work(e, "H13", r);
    assert.deepEqual(result.map((x) => x.status).sort(), [
      "conflicted",
      "succeeded",
    ]);
  },
  async H14(e) {
    await batch(e, "H14.prepare", "archive", [ids["lesson-stale"]]);
    const r = await preview(e, "H14.review", "restore", [
      ids["lesson-archive"],
      ids["lesson-stale"],
    ]);
    await accept(e, "H14.accept", r);
    const claims = await e.call(
      "H14.claim",
      "claim_lesson_bulk_items",
      async () => [2, r.jobId],
    );
    assert.equal(claims.length, 2);
    await e.call("H14.sibling", "process_lesson_bulk_item", async () => [
      claims[0].id,
      claims[0].claim_token,
    ]);
    let current = claims[1];
    for (let i = 0; i < 5; i++) {
      await e.op("H14.age-" + i, async () => {
        const changed = await e.db.query(
          "update lesson_ops.lesson_bulk_items set claim_until=now()-interval '1 second' where id=$1 and job_id=$2 and status='processing' and claim_token=$3",
          [current.id, r.jobId, current.claim_token],
        );
        assert.equal(changed.rowCount, 1);
        return true;
      });
      const next = await e.call(
        "H14.reclaim-" + i,
        "claim_lesson_bulk_items",
        async () => [1, r.jobId],
      );
      if (i === 4) assert.equal(next.length, 0);
      else current = next[0];
      if (i === 0)
        await e.denied(
          "H14.obsolete-token",
          "process_lesson_bulk_item",
          async () => [claims[1].id, claims[1].claim_token],
          /VERSION_CONFLICT/,
        );
    }
    const retry = await e.call("H14.retry", "retry_lesson_bulk", async () => [
      ids.coach,
      r.jobId,
      r.reviewToken,
      key("failed-only-retry"),
    ]);
    assert.equal(retry.queued ?? retry.retried, 1);
    const final = await work(e, "H14.final", r);
    assert.equal(final.length, 1);
    assert.equal(final[0].status, "succeeded");
    // The unchanged succeeded sibling must have exactly its first attempt.
    await e.assert(
      "select attempts v from lesson_ops.lesson_bulk_items where id=$1",
      [claims[0].id],
      1,
    );
  },
  async H15(e) {
    const permitted = await e.auth.guardianRead(e);
    assert.equal(permitted, true);
    await e.op("H15.revoke", async () => {
      await e.db.query(
        "update public.linked_contacts set portal_enabled=false where id=$1 and student_id=$2",
        [ids["guardian-contact"], ids.student],
      );
      return true;
    });
    assert.equal(await e.auth.guardianRead(e), false);
    await e.op("H15.restore", async () => {
      await e.db.query(
        "update public.linked_contacts set portal_enabled=true where id=$1 and student_id=$2",
        [ids["guardian-contact"], ids.student],
      );
      return true;
    });
    assert.equal(await e.auth.guardianRead(e), true);
  },
  async H16(e) {
    const pages = [];
    for (let offset = 0; offset < 2; offset++)
      pages.push(
        await e.call(
          "H16.page-" + offset,
          "lesson_bulk_candidates",
          async () => [
            ids.coach,
            target.studio,
            { studentId: ids["other-student"], includeArchived: true },
            offset,
            1,
          ],
        ),
      );
    assert.notDeepEqual(pages[0].items?.[0], pages[1].items?.[0]);
    const r = await preview(e, "H16.review", "archive", undefined, {
      selectionMode: "matching",
      filter: { studentId: ids["other-student"], includeArchived: true },
      excludedIds: [ids["lesson-provider"]],
    });
    const a = await e.call("H16.progress", "lesson_bulk_progress", async () => [
      ids.coach,
      r.jobId,
      0,
      20,
    ]);
    const b = await e.call("H16.refresh", "lesson_bulk_progress", async () => [
      ids.coach,
      r.jobId,
      0,
      20,
    ]);
    assert.deepEqual(a, b);
    assert(!a.items.some((i) => i.lessonId === ids["lesson-provider"]));
    assert(a.items.every((i) => i.lessonId !== ids["lesson-delete"]));
  },
};
export async function runCases(e) {
  for (const [name, run] of Object.entries(cases)) {
    if (e.journal.find("case", name)) continue;
    await run(e);
    await e.finishCase(name);
  }
}
