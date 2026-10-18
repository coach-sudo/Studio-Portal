import assert from "node:assert/strict";
import { plan, ids, authIds } from "./policy.mjs";
import { processJob } from "./fixtures.mjs";
export const inventory = [
  ["UI01", "New-role identity, private reads and cross-student denial"],
  ["UI02", "Owned profile focus edit, Overview and Household"],
  ["UI03", "Exactly one native UI lesson create and topic edit"],
  [
    "UI04",
    "Four-credit settings, authoritative coverage and stable-key replay",
  ],
  [
    "UI05",
    "Cross-page selection; archive, restore, protected deletion, duplicate acceptance",
  ],
  [
    "UI06",
    "Frozen stale review, exact-item conflict and saved result reopening",
  ],
  ["UI07", "Occurrence cancellation; sibling/ledger/notification isolation"],
  ["UI08", "Owned guardian revocation and fresh read denial"],
  ["UI09", "All-table preservation, exact-ID cleanup and independent proof"],
];
export async function readAs(e, role, fn, args = {}) {
  assert(
    [
      "student_workspace_summary",
      "student_financial_overview",
      "student_credit_coverage",
      "lesson_bulk_progress",
    ].includes(fn),
  );
  e.read();
  await e.db.query("begin read only");
  try {
    await e.db.query("set local role authenticated");
    await e.db.query(
      "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",
      [authIds[role]],
    );
    const entries = Object.entries(args);
    const sql = `select public.${fn}(${entries.map(([k], i) => '"' + k + '" := $' + (i + 1)).join(",")}) value`;
    return (
      await e.db.query(
        sql,
        entries.map(([, v]) => v),
      )
    ).rows[0].value;
  } finally {
    await e.db.query("rollback");
  }
}
const version = (e, table, id) =>
  e.ownRows(table).find((r) => (r.id || r.student_id) === id)?.version || 0;
export function envelope(
  name,
  command,
  payload,
  expectedVersion = 0,
  entityId,
) {
  return {
    command,
    payload,
    expectedVersion,
    ...(entityId ? { entityId } : {}),
    idempotencyKey: plan.runId + ":" + name,
    reason: plan.runId + " " + name,
  };
}
export async function runCases(e, driver) {
  const submit = async (name, path, body) => {
    const response = await driver.submit(name, path, body);
    assert.equal(
      response.status,
      200,
      `${name}: ${JSON.stringify(response.body)}`,
    );
    return response.body.resource;
  };
  const mark = async (name, work) => {
    if (e.journal.find("case", name)) return;
    await work();
    e.journal.append({ type: "case", name });
  };
  await mark("UI01", async () => {
    for (const role of ["coach", "student", "guardian"]) {
      const r = await readAs(
        e,
        role,
        role === "coach"
          ? "student_workspace_summary"
          : "student_financial_overview",
        {
          p_student: ids.student,
        },
      );
      assert.equal(r.studentId, ids.student);
    }
    for (const role of ["student", "guardian", "unrelated"])
      await assert.rejects(
        readAs(e, role, "student_financial_overview", {
          p_student: ids["other-student"],
        }),
        /FORBIDDEN/,
      );
    await driver.views?.("initial");
  });
  await mark("UI02", async () => {
    await submit(
      "UI02.profile",
      "/api/v2/students",
      envelope(
        "UI02.profile",
        "update",
        { focusArea: plan.runId + " focus" },
        version(e, "public.students", ids.student),
        ids.student,
      ),
    );
    assert.equal(
      e.ownRows("public.students").find((r) => r.id === ids.student).focus_area,
      plan.runId + " focus",
    );
  });
  await mark("UI03", async () => {
    const payload = {
      studentId: ids.student,
      topic: plan.runId + " UI lesson",
      ...plan.fixtureContent.uiCreate,
      locationLabel: "Synthetic staging room",
      studentName: plan.runId + " Student 0",
      studentEmail: plan.accounts.student.email,
      timezone: "America/New_York",
    };
    for (const k of [
      "priceMinor",
      "expectedFinancialReviewBeforeCoverage",
      "generatedIdsMaximum",
    ])
      delete payload[k];
    const r = await submit(
      "UI03.create",
      "/api/v2/lessons",
      envelope("UI03.create", "create", payload),
    );
    assert.equal(e.generated.size, 1);
    assert.equal(r.price_minor, null, "Native unknown-price state must remain");
    assert.equal(
      (
        await readAs(e, "coach", "student_financial_overview", {
          p_student: ids.student,
        })
      ).reviewRequired,
      true,
      "Unknown monetary price requires review before credit coverage",
    );
    await submit(
      "UI03.edit",
      "/api/v2/lessons",
      envelope(
        "UI03.edit",
        "update_details",
        { topic: plan.runId + " edited" },
        version(e, "public.lessons", r.id),
        r.id,
      ),
    );
    assert.equal(
      e
        .ownRows("public.lessons")
        .filter((l) => l.topic === plan.runId + " edited").length,
      1,
    );
  });
  await mark("UI04", async () => {
    await submit(
      "UI04.total",
      "/api/v2/credits",
      envelope(
        "UI04.total",
        "set_total",
        { studentId: ids.student, total: 4, reason: plan.runId + " grant" },
        version(e, "public.student_credit_accounts", ids.student),
      ),
    );
    await submit(
      "UI04.auto",
      "/api/v2/credits",
      envelope(
        "UI04.auto",
        "set_auto",
        { studentId: ids.student, enabled: true },
        version(e, "public.student_credit_accounts", ids.student),
      ),
    );
    const body = envelope(
      "UI04.apply",
      "apply_upcoming",
      { studentId: ids.student },
      version(e, "public.student_credit_accounts", ids.student),
    );
    await submit("UI04.apply", "/api/v2/credits", body);
    const ledger = JSON.stringify(e.ownRows("public.package_credit_entries"));
    await submit("UI04.replay", "/api/v2/credits", body);
    assert.equal(
      JSON.stringify(e.ownRows("public.package_credit_entries")),
      ledger,
    );
    const coverage = await readAs(e, "coach", "student_credit_coverage", {
      p_student: ids.student,
    });
    assert.equal(coverage.summary.remaining, 4);
    assert.equal(coverage.summary.reserved, 4);
    assert.equal(coverage.summary.available, 0);
    assert.equal(coverage.counts.covered, 4);
    assert(
      coverage.items.some(
        (i) =>
          i.lessonId === [...e.generated][0] &&
          i.reasonCode === "already_reserved",
      ),
    );
    await driver.views?.("funded");
  });
  const preview = async (name, operation, selected) =>
    submit(
      name,
      "/api/v2/lessons",
      envelope(name, "preview_bulk", {
        operation,
        scope: "selected",
        selectionMode: "ids",
        selectedIds: selected,
        excludedIds: [],
        filter: { studentId: ids.student },
        studentContextId: ids.student,
        wholeClass: false,
        useCredit: false,
      }),
    );
  const execute = async (name, r) => {
    await submit(
      name,
      "/api/v2/lessons",
      envelope(name, "execute_bulk", {
        jobId: r.jobId,
        reviewToken: r.reviewToken,
      }),
    );
    await processJob(e, r.jobId);
  };
  await mark("UI05", async () => {
    const selection = [ids["lesson-page-07"], ids["lesson-page-12"]];
    const archive = await preview("UI05.archive", "archive", selection);
    assert.deepEqual(
      new Set(e.jobs.get(archive.jobId).items.map((i) => i.lesson_id)),
      new Set(selection),
    );
    const body = envelope("UI05.accept", "execute_bulk", {
      jobId: archive.jobId,
      reviewToken: archive.reviewToken,
    });
    await submit("UI05.accept", "/api/v2/lessons", body);
    await submit("UI05.accept-replay", "/api/v2/lessons", body);
    await processJob(e, archive.jobId);
    const restore = await preview("UI05.restore", "restore", selection);
    await execute("UI05.restore-accept", restore);
    const deletion = await preview("UI05.delete", "delete", [
      ids["lesson-delete"],
      ids["lesson-protected"],
    ]);
    assert.equal(deletion.eligible, 1);
    await execute("UI05.delete-accept", deletion);
    assert(
      !e.ownRows("public.lessons").some((l) => l.id === ids["lesson-delete"]),
    );
    assert(
      e.ownRows("public.lessons").some((l) => l.id === ids["lesson-protected"]),
    );
    await driver.reopen?.(archive.jobId);
  });
  await mark("UI06", async () => {
    const stale = await preview("UI06.preview", "archive", [
      ids["lesson-page-08"],
    ]);
    await submit(
      "UI06.change",
      "/api/v2/lessons",
      envelope(
        "UI06.change",
        "update_details",
        { topic: plan.runId + " edited" },
        version(e, "public.lessons", ids["lesson-page-08"]),
        ids["lesson-page-08"],
      ),
    );
    await execute("UI06.accept", stale);
    const items = e
      .ownRows("lesson_ops.lesson_bulk_items")
      .filter((i) => i.job_id === stale.jobId);
    assert.equal(items.length, 1);
    assert(["conflicted", "skipped"].includes(items[0].status));
    await driver.reopen?.(stale.jobId);
  });
  await mark("UI07", async () => {
    const sibling = e
        .ownRows("public.lessons")
        .find((l) => l.id === ids["lesson-credit"]),
      value = {
        action: "cancel",
        scope: "occurrence",
        useCredit: false,
        wholeClass: false,
      };
    const p = await submit(
      "UI07.preview",
      "/api/v2/lessons",
      envelope(
        "UI07.preview",
        "preview_change",
        value,
        version(e, "public.lessons", ids["lesson-cancel"]),
        ids["lesson-cancel"],
      ),
    );
    await submit("UI07.cancel", "/api/v2/lessons", {
      ...envelope(
        "UI07.cancel",
        "execute_change",
        { ...value, reviewToken: p.reviewToken },
        version(e, "public.lessons", ids["lesson-cancel"]),
        ids["lesson-cancel"],
      ),
      reason: e.journal.find("http-intent", "UI07.preview").body.reason,
    });
    assert.deepEqual(
      e.ownRows("public.lessons").find((l) => l.id === sibling.id),
      sibling,
    );
    assert.equal(
      e.ownRows("public.lessons").find((l) => l.id === ids["lesson-cancel"])
        .status,
      "cancelled",
    );
    for (const r of e.ownRows("public.outbox_messages"))
      assert.equal(r.lesson_id, ids["lesson-cancel"]);
  });
  await mark("UI08", async () => {
    const c = e.ownRows("public.linked_contacts")[0];
    e.revokePayload = {
      contactId: c.id,
      fullName: c.full_name,
      email: c.email,
      relationshipType: c.relationship_type,
      relationshipLabel: c.relationship_label,
      canViewSchedule: c.can_view_schedule,
      canManageLessons: c.can_manage_lessons,
      canViewWork: c.can_view_work,
      canManageProfile: c.can_manage_profile,
      canViewFinance: c.can_view_finance,
      canReceiveNotifications: false,
      notificationPreferences: c.notification_preferences || {},
      portalEnabled: false,
    };
    await submit(
      "UI08.revoke",
      "/api/v2/students",
      envelope(
        "UI08.revoke",
        "save_linked_contact",
        e.revokePayload,
        version(e, "public.students", ids.student),
        ids.student,
      ),
    );
    await assert.rejects(
      readAs(e, "guardian", "student_financial_overview", {
        p_student: ids.student,
      }),
      /FORBIDDEN/,
    );
    await driver.views?.("revoked");
  });
}
