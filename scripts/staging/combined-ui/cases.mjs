import assert from "node:assert/strict";
import { plan, ids, authIds } from "./policy.mjs";

export const inventory = ["WEBKIT", "UI08"];
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
