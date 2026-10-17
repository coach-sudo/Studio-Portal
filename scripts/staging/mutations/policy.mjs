import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { URL } from "node:url";
import { plan, plannedId } from "../prepare-hosted-mutation-plan.mjs";

export const target = Object.freeze({
  ...plan.target,
  deployment: "6ad23d4f8b10c10447224155",
  run: plan.runId,
});
export const ids = Object.freeze({
  ...plan.ids,
  ...Object.fromEntries(
    [
      "service",
      "class-service",
      "offering",
      "lesson-stale",
      "membership-coach",
      "membership-student",
      "membership-guardian",
      "relationship",
      "receipt",
    ].map((k) => [k, plannedId(k)]),
  ),
});
export const users = ["coach", "student-user", "guardian", "unrelated"];
export const students = [ids.student, ids["other-student"]];
export const email = (role) =>
  `${target.run}-${role}@coachd-staging.example.test`;
export const sha = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export const manifestHash = sha({ plan, ids });
export const functions = Object.freeze({
  command_grant_student_credits: ["uuid", "text", "jsonb", "uuid"],
  command_student_credit_settings: [
    "uuid",
    "text",
    "jsonb",
    "integer",
    "text",
    "uuid",
  ],
  command_create_lesson: [
    "uuid",
    "uuid",
    "text",
    "timestamptz",
    "timestamptz",
    "text",
    "text",
    "text",
    "text",
    "text",
    "integer",
    "text",
  ],
  command_complete_lesson: ["uuid", "integer", "text", "text", "text"],
  command_make_lesson_recurring: ["uuid", "integer", "text", "integer", "text"],
  reserve_student_upcoming_credits: ["uuid"],
  preview_lesson_occurrence_change: ["uuid", "jsonb"],
  execute_lesson_occurrence_change: ["uuid", "text", "jsonb"],
  preview_lesson_bulk: ["uuid", "uuid", "text", "jsonb"],
  execute_lesson_bulk: ["uuid", "uuid", "text", "text"],
  claim_lesson_bulk_items: ["integer", "uuid"],
  process_lesson_bulk_item: ["uuid", "uuid"],
  retry_lesson_bulk: ["uuid", "uuid", "text", "text"],
  lesson_bulk_progress: ["uuid", "uuid", "integer", "integer"],
  lesson_bulk_candidates: ["uuid", "uuid", "jsonb", "integer", "integer"],
});
export const retained = new Set([
  "public.audit_events",
  "public.idempotency_keys",
  "credit_internal.credit_command_receipts",
  "lesson_ops.receipts",
  "lesson_ops.lesson_bulk_jobs",
  "lesson_ops.lesson_bulk_items",
  "lesson_ops.lesson_bulk_requests",
  "lesson_ops.lesson_deletion_snapshots",
]);
export const mutableTables = new Set([
  ...retained,
  "public.students",
  "public.memberships",
  "public.linked_contacts",
  "public.student_relationships",
  "public.packages",
  "public.package_credit_entries",
  "public.student_credit_accounts",
  "credit_internal.credit_coverage_jobs",
  "public.lessons",
  "public.lesson_participants",
  "public.calendar_projections",
  "public.recurring_series",
  "public.booking_services",
  "public.service_offerings",
  "public.bookings",
  "public.studio_invoices",
  "public.notes",
  "public.recommendations",
  "public.outbox_messages",
  "lesson_ops.effects",
  "lesson_ops.lesson_record_state",
]);
export function assertIdentity(value) {
  assert.deepEqual(value, target, "Exact target/run identity required");
}
export function assertConnection(config, local = false) {
  assert.equal(config.database, "postgres");
  if (local) {
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.port, 56435);
  } else {
    assert.equal(config.host, `db.${target.project}.supabase.co`);
    assert.equal(config.port, 5432);
    assert.equal(config.user, "postgres");
    assert.equal(config.ssl?.rejectUnauthorized, true);
  }
}
export function endpoint(method, value) {
  const u = new URL(value);
  assert.equal(u.protocol, "https:");
  assert(
    !u.username &&
      !u.password &&
      !u.port &&
      !u.hash &&
      !u.pathname.includes("%"),
  );
  if (u.origin === target.origin)
    return method === "GET" && u.pathname === "/api/healthz" && !u.search;
  if (u.origin === "https://api.netlify.com")
    return (
      method === "GET" &&
      [
        `/api/v1/sites/${target.site}`,
        `/api/v1/sites/${target.site}/deploys/${target.deployment}`,
        `/api/v1/accounts/6877f0feedb69199c7837fb3/env`,
        `/api/v1/accounts/6877f0feedb69199c7837fb3/env?site_id=${target.site}`,
      ].includes(u.pathname + u.search)
    );
  if (u.origin === "https://api.supabase.com")
    return (
      method === "GET" &&
      u.pathname === `/v1/projects/${target.project}/config/auth` &&
      !u.search
    );
  if (u.origin !== `https://${target.project}.supabase.co`) return false;
  if (u.pathname === "/auth/v1/admin/users")
    return method === "POST" && !u.search;
  if (users.some((role) => u.pathname === `/auth/v1/admin/users/${ids[role]}`))
    return (
      !u.search &&
      (method === "GET" ||
        (u.pathname.endsWith(ids.coach)
          ? method === "PUT"
          : method === "DELETE"))
    );
  if (u.pathname === "/auth/v1/token")
    return method === "POST" && u.search === "?grant_type=password";
  return (
    method === "POST" &&
    u.pathname === "/rest/v1/rpc/student_financial_overview" &&
    !u.search
  );
}
export const businessRowsMaximum = 512;
export const recordLimits = Object.freeze({
  "public.students": 2,
  "public.lessons": 19,
  "public.packages": 3,
  "public.package_credit_entries": 40,
  "public.memberships": 3,
  "public.linked_contacts": 1,
  "public.student_relationships": 1,
  "public.student_credit_accounts": 2,
  "credit_internal.credit_coverage_jobs": 2,
  "public.booking_services": 2,
  "public.bookings": 2,
  "public.recurring_series": 2,
  "public.service_offerings": 1,
  "public.studio_invoices": 1,
  "public.notes": 1,
  "public.lesson_participants": 20,
  "public.calendar_projections": 19,
  "public.outbox_messages": 2,
  "public.recommendations": 10,
  "public.audit_events": 256,
  "public.idempotency_keys": 40,
  "credit_internal.credit_command_receipts": 12,
  "lesson_ops.receipts": 8,
  "lesson_ops.effects": 4,
  "lesson_ops.lesson_record_state": 5,
  "lesson_ops.lesson_bulk_jobs": 9,
  "lesson_ops.lesson_bulk_items": 40,
  "lesson_ops.lesson_bulk_requests": 30,
  "lesson_ops.lesson_deletion_snapshots": 1,
});
export function assertUnattempted(table, row) {
  if (table === "public.outbox_messages")
    assert(
      row.attempts === 0 &&
        !row.last_error &&
        !row.sent_at &&
        !row.claim_token &&
        ["queued", "cancelled", "suppressed", "draft"].includes(row.status),
      "Delivery activity detected",
    );
  else if (table === "public.calendar_projections")
    assert(
      row.attempts === 0 &&
        !row.first_attempted_at &&
        !row.claim_token &&
        !row.claim_until &&
        !row.last_error &&
        !row.external_event_id &&
        !row.external_version &&
        !row.last_projected_at,
      "Calendar activity detected",
    );
  else assert.fail("Unsupported activity guard");
}
export function assertBudget(snapshot, rpcCount) {
  const rows = (table) =>
    [...(snapshot[table]?.values() || [])].map((x) => x.row);
  for (const [table, maximum] of Object.entries(recordLimits))
    assert(
      rows(table).length <= maximum,
      table === "public.lessons"
        ? "Lesson record budget exceeded"
        : `Record budget exceeded: ${table}`,
    );
  assert(
    Object.values(snapshot).reduce((n, entries) => n + entries.size, 0) <=
      businessRowsMaximum,
    "Business row budget exceeded",
  );
  assert(rows("public.students").length <= 2);
  assert(rows("public.lessons").length <= 19, "Lesson record budget exceeded");
  assert(rows("public.packages").length <= plan.limits.packageLotsMaximum);
  const granted = rows("public.package_credit_entries")
    .filter((r) => ["purchase", "adjustment"].includes(r.kind))
    .reduce((n, r) => n + Math.max(0, r.quantity), 0);
  assert(granted <= plan.limits.creditGrantMaximum, "Credit budget exceeded");
  assert(
    rows("public.bookings").reduce((n, r) => n + Number(r.total_minor), 0) <=
      plan.limits.syntheticCashMinorMaximum,
    "Cash budget exceeded",
  );
  assert(rows("public.studio_invoices").length <= 1);
  assert(rows("public.notes").length <= 1);
  assert(rows("public.booking_services").length <= 2);
  assert(rows("public.bookings").length <= 2);
  assert(rows("public.recurring_series").length <= 2);
  assert(rows("public.service_offerings").length <= 1);
  assert(rows("public.outbox_messages").length <= 2);
  assert(rows("lesson_ops.lesson_bulk_jobs").length <= 9);
  assert(rows("lesson_ops.lesson_bulk_items").length <= 40);
  assert(
    rpcCount <= plan.limits.commandRequestsMaximum,
    "Command budget exceeded",
  );
  for (const r of [
    ...rows("public.bookings"),
    ...rows("public.packages"),
    ...rows("public.studio_invoices"),
  ])
    assert.equal(r.currency, "USD");
  for (const r of rows("public.calendar_projections"))
    assertUnattempted("public.calendar_projections", r);
  for (const r of rows("public.outbox_messages"))
    assertUnattempted("public.outbox_messages", r);
}
export function owned(table, r, sets) {
  const own = (id) => sets.has(id);
  const studio = () => r.studio_id === target.studio;
  const student = () => students.includes(r.student_id);
  switch (table) {
    case "public.students":
      return (
        students.includes(r.id) &&
        studio() &&
        r.full_name.startsWith(target.run + " ")
      );
    case "public.memberships":
      return studio() && users.some((k) => ids[k] === r.user_id);
    case "public.linked_contacts":
      return (
        r.id === ids["guardian-contact"] &&
        studio() &&
        student() &&
        r.user_id === ids.guardian
      );
    case "public.student_relationships":
      return student() && r.user_id === ids.guardian;
    case "public.booking_services":
      return (
        [ids.service, ids["class-service"]].includes(r.id) &&
        studio() &&
        [target.run, target.run + "-class"].includes(r.slug)
      );
    case "public.service_offerings":
      return (
        r.id === ids.offering &&
        studio() &&
        r.service_id === ids["class-service"] &&
        r.lesson_ids.every(own)
      );
    case "public.lessons":
      return (
        own(r.id) &&
        student() &&
        studio() &&
        r.topic.startsWith(target.run + " ") &&
        !r.source_external_id &&
        !r.calendar_event_id &&
        !r.join_url
      );
    case "public.packages":
      return r.id === ids.package && student() && r.name.startsWith(target.run);
    case "public.package_credit_entries":
      return r.package_id === ids.package && (!r.lesson_id || own(r.lesson_id));
    case "public.student_credit_accounts":
    case "credit_internal.credit_coverage_jobs":
      return student();
    case "public.lesson_participants":
      return (
        own(r.lesson_id) &&
        student() &&
        (!r.booking_id || own(r.booking_id)) &&
        r.email.endsWith("@coachd-staging.example.test")
      );
    case "public.calendar_projections":
      return own(r.lesson_id);
    case "public.recurring_series":
      return (
        studio() &&
        student() &&
        (!r.service_id || r.service_id === ids.service) &&
        !r.stripe_subscription_id
      );
    case "public.bookings":
      return (
        [ids["shared-booking"], ids["shared-prepaid"]].includes(r.id) &&
        studio() &&
        student() &&
        r.service_id === ids.service &&
        r.guest_email.endsWith("@coachd-staging.example.test") &&
        !r.stripe_checkout_session_id &&
        !r.stripe_customer_id
      );
    case "public.studio_invoices":
      return (
        r.id === ids.invoice &&
        studio() &&
        student() &&
        Number(r.total_minor) === 0
      );
    case "public.notes":
      return r.id === ids.note && student() && own(r.lesson_id);
    case "public.audit_events":
      return (
        studio() &&
        (!r.actor_id || r.actor_id === ids.coach) &&
        own(r.entity_id)
      );
    case "public.recommendations":
      return studio() && student() && own(r.entity_id);
    case "public.outbox_messages":
      return (
        studio() &&
        student() &&
        own(r.lesson_id) &&
        r.recipient.endsWith("@coachd-staging.example.test")
      );
    case "public.idempotency_keys":
      return (
        r.key.startsWith(target.run + ":") &&
        (!r.actor_id || r.actor_id === ids.coach)
      );
    case "credit_internal.credit_command_receipts":
      return (
        student() &&
        r.actor_id === ids.coach &&
        r.key.startsWith(target.run + ":")
      );
    case "lesson_ops.receipts":
      return (
        studio() &&
        r.actor_id === ids.coach &&
        own(r.request?.lessonId) &&
        (r.key.startsWith("reviewed:" + target.run + ":") ||
          r.key.startsWith("occurrence:" + r.request.lessonId + ":"))
      );
    case "lesson_ops.effects":
      return (
        own(r.lesson_id) &&
        r.student_ids.every((x) => students.includes(x)) &&
        r.attempts === 0 &&
        !r.claim_token &&
        r.outbox_ids.length === 0
      );
    case "lesson_ops.lesson_bulk_jobs":
      return (
        studio() &&
        r.actor_id === ids.coach &&
        (r.request?.selectedIds?.every(own) ||
          (r.request?.selectionMode === "matching" &&
            students.includes(r.request?.filter?.studentId)))
      );
    case "lesson_ops.lesson_bulk_items":
      return own(r.job_id) && own(r.lesson_id);
    case "lesson_ops.lesson_bulk_requests":
      return own(r.job_id) && r.actor_id === ids.coach;
    case "lesson_ops.lesson_deletion_snapshots":
      return (
        studio() &&
        r.actor_id === ids.coach &&
        own(r.job_id) &&
        own(r.lesson_id)
      );
    case "lesson_ops.lesson_record_state":
      return studio() && own(r.lesson_id);
    default:
      return false;
  }
}
