import { URL } from "node:url";
// Separate UI run. No imports from, or authority delegated to, the H01-H16 executor.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { plan as proposal, plannedUiId } from "../prepare-combined-ui-plan.mjs";
// Preserve the historical proposal. PostgreSQL's installed enum spells the
// unpaid state `due`; this explicit correction changes no IDs/budgets/policy.
export const plan = {
  ...proposal,
  fixtureContent: {
    ...proposal.fixtureContent,
    lessons: proposal.fixtureContent.lessons.map((l) => ({
      ...l,
      paymentStatus: "due",
    })),
  },
};
export const candidate = "36f446392dd940ad25b0ba7449b7dad8d938c636";
export const sha = (v) =>
  createHash("sha256")
    .update(typeof v === "string" ? v : JSON.stringify(v))
    .digest("hex");
export const manifestHash = sha(plan);
export const ids = {
  ...plan.records,
  ...Object.fromEntries(
    ["coach", "student", "guardian"].map((k) => [
      "membership-" + k,
      plannedUiId("membership-" + k),
    ]),
  ),
};
export const students = [ids.student, ids["other-student"]];
// The account and student labels intentionally differ: plan.records.student is
// the business row, plan.accounts.student.id is the Auth identity.
ids.student = plan.records.student;
export const authIds = Object.fromEntries(
  Object.entries(plan.accounts).map(([k, v]) => [k, v.id]),
);
export const tableNames = JSON.parse(
  readFileSync(
    new URL(
      "../../../docs/wave-one-hosted-business-verification.json",
      import.meta.url,
    ),
    "utf8",
  ),
)
  .tables.map((t) => t.table)
  .sort();
export const quote = (s) => {
  assert.match(s, /^[a-z_]+$/);
  return '"' + s + '"';
};
export const identifier = (s) => s.split(".").map(quote).join(".");
export const strict = (obj, keys) => {
  assert(obj && typeof obj === "object" && !Array.isArray(obj));
  assert(
    Object.keys(obj).every((k) => keys.includes(k)),
    "Unreviewed payload property",
  );
};
export function binding(value) {
  strict(value, [
    "site",
    "project",
    "studio",
    "deployment",
    "candidate",
    "origin",
    "artifactHash",
  ]);
  for (const k of ["site", "project", "studio"])
    assert.equal(value[k], plan.target[k], "Wrong staging target");
  assert.equal(value.candidate, candidate, "Wrong candidate");
  assert.equal(value.deployment, plan.target.deployment);
  assert(
    !["6ad39275e099502cb54a8f64", "6ad23d4f8b10c10447224155"].includes(
      value.deployment,
    ),
    "Old deployment forbidden",
  );
  assert.equal(
    value.origin,
    `https://${value.deployment}--coachd-staging.netlify.app`,
  );
  assert.match(value.artifactHash, /^[a-f0-9]{64}$/);
  return value;
}
export function authorization(r, target, codeHash, now = Date.now()) {
  strict(r, [
    "runId",
    "target",
    "manifestHash",
    "executorHash",
    "baselineHash",
    "issuedAt",
    "expiresAt",
    "scope",
    "allowCleanup",
    "approvedBy",
  ]);
  assert.equal(r.runId, plan.runId);
  assert.deepEqual(binding(r.target), binding(target));
  assert.equal(r.manifestHash, manifestHash);
  assert.equal(r.executorHash, codeHash);
  assert.match(r.baselineHash, /^[a-f0-9]{64}$/);
  assert.equal(r.scope, "UI05-UI08+WAVE2");
  assert.equal(r.allowCleanup, true);
  assert(typeof r.approvedBy === "string" && r.approvedBy.trim().length > 2);
  assert(
    Number.isFinite(Date.parse(r.issuedAt)) &&
      Date.parse(r.issuedAt) <= now &&
      now < Date.parse(r.expiresAt),
    "Expired/future authorization",
  );
  assert(
    Date.parse(r.expiresAt) - Date.parse(r.issuedAt) <= 86400000,
    "Approval window exceeds 24 hours",
  );
}
export function connection(c, local = false) {
  strict(c, ["host", "port", "user", "database", "password", "ssl"]);
  if (local) {
    assert.equal(c.host, "127.0.0.1");
    assert(c.port >= 49152 && c.port <= 65535);
    assert.match(c.database, /^ui_[a-z_]+$/);
    return;
  }
  assert.equal(c.host, `db.${plan.target.project}.supabase.co`);
  assert.equal(c.port, 5432);
  assert.equal(c.database, "postgres");
  assert.equal(c.user, "postgres");
  assert.deepEqual(c.ssl, { rejectUnauthorized: true });
  assert(c.password);
}
export const retained = new Set([
  "public.notes",
  "public.materials",
  "public.material_links",
  "public.audit_events",
  "public.idempotency_keys",
  "public.package_credit_entries",
  "public.packages",
  "public.lessons",
  "public.lesson_participants",
  "public.student_credit_accounts",
  "public.students",
  "lesson_ops.receipts",
  "credit_internal.credit_command_receipts",
  "lesson_ops.lesson_bulk_jobs",
  "lesson_ops.lesson_bulk_items",
  "lesson_ops.lesson_bulk_requests",
  "lesson_ops.lesson_deletion_snapshots",
  "lesson_ops.lesson_record_state",
]);
export function assertUndelivered(t, r) {
  if (t === "credit_internal.credit_coverage_jobs")
    assert(r.attempts === 0 && !r.last_error, "Coverage worker activity");
  if (t === "public.outbox_messages")
    assert(
      !r.sent_at &&
        !r.claim_token &&
        !r.last_error &&
        r.attempts === 0 &&
        ["queued", "suppressed", "cancelled", "draft"].includes(r.status) &&
        Object.values(plan.accounts).some((a) => a.email === r.recipient),
      "Delivery activity",
    );
  if (t === "public.calendar_projections")
    assert(
      !r.first_attempted_at &&
        !r.last_projected_at &&
        !r.external_event_id &&
        !r.external_version &&
        !r.claim_token &&
        !r.claim_until &&
        !r.last_error &&
        r.attempts === 0,
      "Calendar activity",
    );
  if (t === "lesson_ops.effects")
    assert(
      r.status !== "processing" &&
        r.attempts === 0 &&
        !r.claim_token &&
        !r.claim_until &&
        !r.last_error,
      "Effect activity",
    );
}
export function owned(
  t,
  r,
  generated = new Set(),
  jobs = new Map(),
  audits = new Map(),
  keys = new Set(),
) {
  const student = students.includes(r.student_id),
    lesson = [
      ...plan.fixtureContent.lessons.map((l) => l.id),
      ...generated,
    ].includes(r.lesson_id);
  const studio = r.studio_id === plan.target.studio;
  if (t === "public.students")
    return (
      students.includes(r.id) &&
      studio &&
      (r.id === ids.student
        ? [authIds.student, null].includes(r.user_id)
        : r.user_id === null)
    );
  if (t === "public.memberships")
    return (
      studio &&
      ["coach", "student", "guardian"].some(
        (k) =>
          r.id === ids["membership-" + k] &&
          r.user_id === authIds[k] &&
          r.role === k,
      )
    );
  if (t === "public.linked_contacts")
    return (
      ((r.id === ids.contact && r.student_id === ids.student) ||
        (r.id === ids["other-contact"] &&
          r.student_id === ids["other-student"])) &&
      studio &&
      [authIds.guardian, null].includes(r.user_id)
    );
  if (t === "public.student_relationships")
    return students.includes(r.student_id) && r.user_id === authIds.guardian;
  if (t === "public.notes")
    return (
      [ids["note-published"], ids["note-draft"]].includes(r.id) &&
      r.student_id === ids.student &&
      r.lesson_id === ids["lesson-edit"]
    );
  if (t === "public.materials")
    return (
      r.id === ids["material-private"] &&
      studio &&
      r.owner_student_id === ids["other-student"] &&
      r.external_url === "https://example.invalid/private-file"
    );
  if (t === "public.material_links")
    return (
      r.id === ids["material-link"] &&
      r.material_id === ids["material-private"] &&
      r.student_id === ids["other-student"] &&
      !r.visible_to_student
    );
  if (t === "public.booking_services")
    return r.id === ids.service && studio && r.price_minor === 0;
  if (t === "public.packages")
    return r.id === ids.package && r.student_id === ids.student;
  if (t === "public.lessons")
    return (
      (plan.fixtureContent.lessons.some((l) => l.id === r.id) ||
        generated.has(r.id)) &&
      r.student_id === ids.student &&
      studio &&
      r.source_provider === "studio" &&
      !r.source_external_id &&
      !r.series_id &&
      !r.offering_id &&
      r.capacity === 1
    );
  if (t === "public.package_credit_entries")
    return (
      r.package_id === ids.package &&
      (!r.student_id || r.student_id === ids.student) &&
      (!r.lesson_id || lesson)
    );
  if (
    [
      "public.student_credit_accounts",
      "credit_internal.credit_coverage_jobs",
    ].includes(t)
  )
    return student;
  if (
    [
      "public.lesson_participants",
      "public.calendar_projections",
      "public.outbox_messages",
      "lesson_ops.effects",
      "lesson_ops.lesson_record_state",
    ].includes(t)
  )
    return lesson && (!r.student_id || student) && (!r.studio_id || studio);
  if (t === "public.audit_events")
    return (
      studio &&
      ((r.actor_id === authIds.coach &&
        (keys.has(r.correlation_id) || jobs.has(r.correlation_id))) ||
        (r.actor_id === null &&
          r.source === "studio_command" &&
          audits.get(r.id)?.entityId === r.entity_id &&
          audits.get(r.id)?.action === r.action &&
          audits.get(r.id)?.entityType === r.entity_type)) &&
      (Object.values(plan.records).includes(r.entity_id) ||
        generated.has(r.entity_id) ||
        jobs.has(r.entity_id))
    );
  if (t === "public.idempotency_keys")
    return (
      r.studio_id === plan.target.studio &&
      r.actor_id === authIds.coach &&
      keys.has(r.key)
    );
  if (t === "credit_internal.credit_command_receipts")
    return (
      r.student_id === ids.student &&
      r.actor_id === authIds.coach &&
      keys.has(r.key)
    );
  if (t === "lesson_ops.receipts")
    return (
      studio &&
      r.actor_id === authIds.coach &&
      keys.has(r.key.replace(/^reviewed:/, "")) &&
      (!r.request?.lessonId ||
        [
          ...plan.fixtureContent.lessons.map((l) => l.id),
          ...generated,
        ].includes(r.request.lessonId))
    );
  if (t === "lesson_ops.lesson_bulk_jobs")
    return (
      studio &&
      r.actor_id === authIds.coach &&
      jobs.has(r.id) &&
      r.operation === jobs.get(r.id).operation &&
      r.request.studentContextId === ids.student &&
      r.request.selectedIds.every((id) => jobs.get(r.id).ids.includes(id)) &&
      r.request.selectedIds.length === jobs.get(r.id).ids.length
    );
  if (t === "lesson_ops.lesson_bulk_requests")
    return (
      jobs.has(r.job_id) &&
      r.actor_id === authIds.coach &&
      keys.has(r.key.replace(/^(preview|execute|retry):/, ""))
    );
  if (
    [
      "lesson_ops.lesson_bulk_items",
      "lesson_ops.lesson_deletion_snapshots",
    ].includes(t)
  )
    return (
      jobs.has(r.job_id) &&
      (!r.lesson_id || (lesson && jobs.get(r.job_id).ids.includes(r.lesson_id)))
    );
  return false;
}
export function guardCommand(path, b, role, state) {
  strict(b, [
    "command",
    "entityId",
    "payload",
    "reason",
    "expectedVersion",
    "idempotencyKey",
  ]);
  assert.equal(role, "coach", "Mutation role denied");
  assert(typeof b.reason === "string" && b.reason.length >= 3);
  assert(Number.isInteger(b.expectedVersion) && b.expectedVersion >= 0);
  assert(
    typeof b.idempotencyKey === "string" &&
      (b.idempotencyKey.startsWith(plan.runId + ":") ||
        (b.command === "execute_bulk" &&
          state.jobs.has(b.payload?.jobId) &&
          b.idempotencyKey === "bulk-execute:" + b.payload.jobId) ||
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(b.idempotencyKey)),
    "Foreign idempotency key",
  );
  const p = b.payload;
  assert(p);
  const ownLesson = (id) =>
    plan.fixtureContent.lessons.some((l) => l.id === id) ||
    state.generated.has(id);
  if (path === "/api/v2/credits") {
    assert(["set_total", "set_auto", "apply_upcoming"].includes(b.command));
    assert.equal(p.studentId, ids.student);
    strict(p, [
      "studentId",
      ...(b.command === "set_total"
        ? ["total", "reason"]
        : b.command === "set_auto"
          ? ["enabled"]
          : []),
    ]);
    if (b.command === "set_total") {
      assert.equal(p.total, 4);
      assert(typeof p.reason === "string" && p.reason.length >= 3);
    }
    if (b.command === "set_auto") assert.equal(typeof p.enabled, "boolean");
    return;
  }
  if (path === "/api/v2/students") {
    assert.equal(b.entityId, ids.student);
    if (b.command === "update") {
      if (Object.keys(p).length === 1) {
        strict(p, ["focusArea"]);
        assert.equal(p.focusArea, plan.runId + " focus");
      } else
        assert.deepEqual(
          p,
          state.profilePayload,
          "Identity fields changed in profile form",
        );
      return;
    }
    assert.equal(b.command, "save_linked_contact");
    assert.equal(p.contactId, ids.contact);
    assert.equal(p.portalEnabled, false);
    assert.equal(p.canReceiveNotifications, false);
    // Entire contact payload must equal the independently captured owned contact,
    // except revocation. No email/name/responsibility or provider preference edit.
    assert.deepEqual(
      p,
      state.revokePayload,
      "Not the exact reviewed revocation payload",
    );
    return;
  }
  assert.equal(path, "/api/v2/lessons", "Endpoint prohibited");
  assert.notEqual(
    b.command,
    "create",
    "This focused run cannot create lessons through HTTP",
  );
  if (b.command === "create") {
    strict(p, [
      "studentId",
      "topic",
      "startsAt",
      "endsAt",
      "locationType",
      "locationLabel",
      "recurrence",
      "occurrenceCount",
      "timezone",
      "studentName",
      "studentEmail",
    ]);
    assert.equal(p.studentId, ids.student);
    assert.equal(
      new Date(p.startsAt).toISOString(),
      new Date(plan.fixtureContent.uiCreate.startsAt).toISOString(),
    );
    assert.equal(
      new Date(p.endsAt).toISOString(),
      new Date(plan.fixtureContent.uiCreate.endsAt).toISOString(),
    );
    assert.equal(p.locationType, "in_person");
    assert.equal(p.recurrence, "none");
    assert([undefined, 1].includes(p.occurrenceCount));
    assert.equal(p.studentEmail, plan.accounts.student.email);
    assert([undefined, "America/New_York"].includes(p.timezone));
    assert([undefined, plan.runId + " Student 0"].includes(p.studentName));
    assert([undefined, "Synthetic staging room"].includes(p.locationLabel));
    assert.equal(p.topic, plan.runId + " UI lesson");
    assert.equal(
      state.createAttempted,
      false,
      "Non-idempotent create cannot be resubmitted",
    );
    return;
  }
  if (b.command === "update_details") {
    assert(ownLesson(b.entityId));
    strict(p, ["topic", "locationType", "locationLabel", "joinUrl"]);
    assert.equal(p.topic, plan.runId + " edited");
    assert([undefined, "in_person"].includes(p.locationType));
    assert(!p.joinUrl);
    return;
  }
  if (["preview_change", "execute_change"].includes(b.command)) {
    assert.equal(b.entityId, ids["lesson-cancel"]);
    strict(p, [
      "action",
      "scope",
      "useCredit",
      "wholeClass",
      "reviewToken",
      "studentContextId",
    ]);
    assert([undefined, ids.student].includes(p.studentContextId));
    assert.equal(p.action, "cancel");
    assert.equal(p.scope, "occurrence");
    assert(!p.wholeClass);
    assert(typeof p.useCredit === "boolean");
    return;
  }
  if (b.command === "preview_bulk") {
    strict(p, [
      "operation",
      "scope",
      "selectionMode",
      "selectedIds",
      "excludedIds",
      "filter",
      "studentContextId",
      "wholeClass",
      "useCredit",
    ]);
    assert(["archive", "restore", "delete"].includes(p.operation));
    assert.equal(p.scope, "selected");
    assert.equal(p.studentContextId, ids.student);
    assert(!p.wholeClass && !p.useCredit);
    assert.equal(p.selectionMode, "ids");
    assert(
      p.selectedIds.length > 0 &&
        p.selectedIds.length <= 13 &&
        new Set(p.selectedIds).size === p.selectedIds.length,
    );
    assert(p.selectedIds.every(ownLesson));
    assert(!p.filter || p.filter.studentId === ids.student);
    assert(!p.excludedIds?.length);
    return;
  }
  assert(
    ["execute_bulk", "retry_bulk"].includes(b.command),
    "Command prohibited",
  );
  strict(p, ["jobId", "reviewToken"]);
  assert(state.jobs.has(p.jobId));
  assert.equal(p.reviewToken, state.jobs.get(p.jobId).token);
}
