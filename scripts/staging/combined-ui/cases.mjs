import assert from "node:assert/strict";
import { plan, ids, authIds } from "./policy.mjs";
import { processJob } from "./fixtures.mjs";
export const inventory = ["UI05", "UI06", "UI07", "UI08", "WAVE2"];
export async function readAs(e, role, fn, args = {}) {
  assert(
    [
      "studio_global_search",
      "studio_record_target",
      "portal_student_contexts",
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
  await submit(
    "SETUP.total",
    "/api/v2/credits",
    envelope(
      "SETUP.total",
      "set_total",
      {
        studentId: ids.student,
        total: 4,
        reason: plan.runId + " fixture funding",
      },
      version(e, "public.student_credit_accounts", ids.student),
    ),
  );
  await submit(
    "SETUP.auto",
    "/api/v2/credits",
    envelope(
      "SETUP.auto",
      "set_auto",
      { studentId: ids.student, enabled: true },
      version(e, "public.student_credit_accounts", ids.student),
    ),
  );
  await driver.views?.("wave2");
  for (const role of ["coach", "student", "guardian", "unrelated"]) {
    const search = await readAs(e, role, "studio_global_search", {
      p_query: plan.runId,
      p_student: role === "coach" ? null : ids.student,
    });
    assert(search.items.length <= 25);
    for (const kind of ["student", "lesson", "booking", "resource", "note"])
      assert(search.items.filter((x) => x.kind === kind).length <= 5);
    assert(!JSON.stringify(search).includes("https://"));
    if (role !== "coach") {
      assert(
        !search.items.some((x) =>
          [ids["note-draft"], ids["material-private"]].includes(x.id),
        ),
      );
      assert.equal(
        await readAs(e, role, "studio_record_target", {
          p_kind: "note",
          p_id: ids["note-draft"],
          p_student: ids.student,
        }),
        null,
      );
      assert.equal(
        await readAs(e, role, "studio_record_target", {
          p_kind: "resource",
          p_id: ids["material-private"],
          p_student: ids["other-student"],
        }),
        null,
      );
    }
    if (role === "unrelated") assert.equal(search.items.length, 0);
  }
  const family = await readAs(e, "guardian", "portal_student_contexts", {
    p_student: ids["other-student"],
  });
  assert.equal(family.items.length, 2);
  assert.equal(family.selected.id, ids["other-student"]);
  assert.equal(family.selected.canViewWork, false);
  assert.equal(
    (
      await readAs(e, "student", "portal_student_contexts", {
        p_student: ids["other-student"],
      })
    ).selected,
    null,
  );
  assert.equal(
    (
      await readAs(e, "guardian", "portal_student_contexts", {
        p_student: ids.unavailable,
      })
    ).selected,
    null,
  );
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
  await driver.views?.("before-revocation");
  await driver.secondaryViews?.();
  await mark("UI08", async () => {
    const c = e
      .ownRows("public.linked_contacts")
      .find((c) => c.id === ids.contact);
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
    const context = await readAs(e, "guardian", "portal_student_contexts", {
      p_student: ids.student,
    });
    assert.equal(context.selected, null);
    assert.deepEqual(
      context.items.map((x) => x.id),
      [ids["other-student"]],
    );
    assert.equal(
      (
        await readAs(e, "guardian", "studio_global_search", {
          p_query: plan.runId,
          p_student: ids.student,
        })
      ).items.length,
      0,
    );
  });
}
