import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../../../src/types/database.generated";
import { evaluateLessonReadiness } from "../../../src/domain/lessonReadiness";
import { evaluateAutomationRule } from "../../../src/domain/automationRules";
import {
  recipientIntents,
  type RecipientIntent,
} from "../../../src/domain/notificationRecipients";
import { loadOperationalData } from "./operational-data";
import { mapAutomationRule } from "./automation-config";
import { resolveEventRecipients } from "./notification-recipients";

export type OutboxEligibility =
  { allowed: true } | { allowed: false; reason: string };
export function messageIntent(
  message: Pick<Tables<"outbox_messages">, "recipient_intent" | "event_key">,
): RecipientIntent | "coach" | undefined {
  const explicit = message.recipient_intent;
  if (explicit === "coach") return "coach";
  if (recipientIntents.includes(explicit as RecipientIntent))
    return explicit as RecipientIntent;
  const event = message.event_key ?? "";
  if (event.endsWith(".coach")) return "coach";
  if (event.includes("reminder")) return "lesson_reminder";
  if (event.startsWith("payment."))
    return event.includes("failed") ? "payment_failed" : "payment_due";
  if (event.startsWith("package."))
    return /expir/.test(event) ? "package_expiration" : "package_low";
  if (event.includes("reschedul")) return "schedule_change";
  if (event.includes("cancel")) return "cancellation";
  if (event.includes("confirmed.student")) return "lesson_confirmation";
  if (event.startsWith("assignment")) return "assignment";
  if (event.startsWith("note")) return "lesson_content";
  return undefined;
}
/** Fail closed on obsolete automated content; human-authored email remains a separate explicit action. */
export async function checkOutboxEligibility(
  client: SupabaseClient,
  message: Tables<"outbox_messages">,
  now = Date.now(),
): Promise<OutboxEligibility> {
  const db = client as SupabaseClient<Database>,
    intent = messageIntent(message);
  if (message.campaign_id) {
    const result = await db
      .from("mailing_list_contacts")
      .select("unsubscribed_at")
      .eq("studio_id", message.studio_id)
      .eq("email", message.recipient.toLowerCase())
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data || result.data.unsubscribed_at)
      return { allowed: false, reason: "preference_disabled" };
  }
  if (message.automation_rule_id) {
    const result = await db
      .from("automation_rules")
      .select("*")
      .eq("id", message.automation_rule_id)
      .eq("studio_id", message.studio_id)
      .single();
    if (result.error) throw result.error;
    if (!result.data.enabled || result.data.mode === "off")
      return { allowed: false, reason: "rule_off" };
  }
  if (!intent) return { allowed: true };
  const studio = await db
    .from("studios")
    .select("settings")
    .eq("id", message.studio_id)
    .single();
  if (studio.error) throw studio.error;
  const settings = studio.data.settings as {
    contactEmail?: string;
    emailAutomations?: { enabled?: boolean; coachNewBooking?: boolean };
  };
  if (settings.emailAutomations?.enabled === false)
    return { allowed: false, reason: "automation_disabled" };
  if (intent === "coach") {
    if (!message.automation_rule_id) {
      if (
        settings.contactEmail?.toLowerCase() !== message.recipient.toLowerCase()
      )
        return { allowed: false, reason: "coach_recipient_changed" };
    } else {
      const memberships = await db
        .from("memberships")
        .select("user_id")
        .eq("studio_id", message.studio_id)
        .eq("role", "coach");
      if (memberships.error) throw memberships.error;
      let allowed = false;
      for (const membership of memberships.data) {
        const user = await db.auth.admin.getUserById(membership.user_id);
        if (user.error) throw user.error;
        if (
          user.data.user?.email?.toLowerCase() ===
          message.recipient.toLowerCase()
        )
          allowed = true;
      }
      if (!allowed)
        return { allowed: false, reason: "coach_permission_removed" };
    }
  }
  const snapshot = (message.entity_snapshot ?? {}) as {
    startsAt?: string;
    endsAt?: string;
    entityId?: string;
  };
  let studentId = message.student_id;
  if (message.lesson_id) {
    const result = await db
      .from("lessons")
      .select("student_id,starts_at,ends_at,status")
      .eq("id", message.lesson_id)
      .eq("studio_id", message.studio_id)
      .single();
    if (result.error) throw result.error;
    if (
      [
        "lesson_reminder",
        "payment_due",
        "payment_past_due",
        "payment_failed",
        "lesson_confirmation",
      ].includes(intent) &&
      result.data.status !== "scheduled"
    )
      return { allowed: false, reason: "lesson_not_scheduled" };
    if (
      snapshot.startsAt &&
      (Date.parse(snapshot.startsAt) !== Date.parse(result.data.starts_at) ||
        (snapshot.endsAt &&
          Date.parse(snapshot.endsAt) !== Date.parse(result.data.ends_at)))
    )
      return { allowed: false, reason: "lesson_rescheduled" };
    if (
      intent === "lesson_reminder" &&
      Date.parse(result.data.starts_at) <= now
    )
      return { allowed: false, reason: "lesson_started" };
    studentId ??= result.data.student_id;
  }
  if (
    message.booking_id &&
    ["payment_due", "payment_past_due", "payment_failed"].includes(intent)
  ) {
    const booking = await db
      .from("bookings")
      .select("payment_status,status")
      .eq("id", message.booking_id)
      .eq("studio_id", message.studio_id)
      .single();
    if (booking.error) throw booking.error;
    if (
      ["paid", "not_required", "processing"].includes(
        booking.data.payment_status,
      )
    )
      return { allowed: false, reason: "financial_condition_resolved" };
    if (
      ["cancelled", "expired", "late_cancelled"].includes(booking.data.status)
    )
      return { allowed: false, reason: "booking_cancelled" };
  }
  if (studentId && intent !== "coach") {
    const resolved = await resolveEventRecipients(client, studentId, intent);
    if (
      !resolved.recipients.some(
        (recipient) =>
          recipient.email.toLowerCase() === message.recipient.toLowerCase(),
      )
    )
      return { allowed: false, reason: "recipient_no_longer_eligible" };
  }
  if (!studentId && intent !== "coach" && message.lesson_id) {
    const participants = await db
      .from("lesson_participants")
      .select("student_id")
      .eq("lesson_id", message.lesson_id)
      .neq("status", "cancelled");
    if (participants.error) throw participants.error;
    let allowed = false;
    for (const participant of participants.data)
      if (participant.student_id) {
        const resolved = await resolveEventRecipients(
          client,
          participant.student_id,
          intent,
        );
        if (
          resolved.recipients.some(
            (recipient) =>
              recipient.email.toLowerCase() === message.recipient.toLowerCase(),
          )
        )
          allowed = true;
      }
    if (!allowed && !message.booking_id)
      return { allowed: false, reason: "recipient_no_longer_eligible" };
  }
  if (
    studentId &&
    message.lesson_id &&
    ["payment_due", "payment_past_due", "payment_failed"].includes(intent)
  ) {
    const data = await loadOperationalData(
        client,
        message.studio_id,
        studentId,
      ),
      lesson = data.lessons.find((item) => item.id === message.lesson_id);
    if (!lesson) return { allowed: false, reason: "lesson_unavailable" };
    if (lesson.paymentStatus === "paid_by_credit")
      return { allowed: false, reason: "financial_condition_resolved" };
    const readiness = evaluateLessonReadiness(lesson, data, now);
    if (
      [
        "covered_paid",
        "covered_package",
        "covered_waived",
        "payment_processing",
      ].includes(readiness.financial.state)
    )
      return { allowed: false, reason: "financial_condition_resolved" };
  }
  if (studentId && message.automation_rule_id && snapshot.entityId) {
    const result = await db
      .from("automation_rules")
      .select("*")
      .eq("id", message.automation_rule_id)
      .single();
    if (result.error) throw result.error;
    const rule = mapAutomationRule(result.data),
      data = await loadOperationalData(client, message.studio_id, studentId);
    const entity = rule.key.startsWith("package_")
      ? { package: data.packages.find((item) => item.id === snapshot.entityId) }
      : rule.key === "delivery_failure"
        ? { message: data.outbox.find((item) => item.id === snapshot.entityId) }
        : {
            lesson: data.lessons.find((item) => item.id === snapshot.entityId),
          };
    const decision = evaluateAutomationRule(rule, entity, data, now);
    if (!decision.eligible)
      return {
        allowed: false,
        reason: decision.suppressedReason ?? "condition_resolved",
      };
  }
  return { allowed: true };
}
export async function suppressOutbox(
  client: SupabaseClient,
  message: Tables<"outbox_messages">,
  reason: string,
) {
  const db = client as SupabaseClient<Database>;
  const result = await db
    .from("outbox_messages")
    .update({
      status: "cancelled",
      suppression_reason: reason,
      last_error: null,
      updated_at: new Date().toISOString(),
      version: message.version + 1,
    })
    .eq("id", message.id)
    .in("status", ["draft", "approved", "queued", "failed", "sending"]);
  if (result.error) throw result.error;
  if (message.automation_rule_id) {
    const result = await db.from("automation_runs").upsert(
      {
        studio_id: message.studio_id,
        rule_id: message.automation_rule_id,
        entity_type: "outbox",
        entity_id: message.id,
        result: "suppressed",
        explanation: `Message suppressed before delivery: ${reason}.`,
        suppressed_reason: reason,
        outbox_ids: [message.id],
        correlation_id: message.correlation_id ?? crypto.randomUUID(),
        decision: { phase: "dispatch", reason },
        decision_key: `dispatch:${message.id}:${reason}`,
      },
      { onConflict: "decision_key", ignoreDuplicates: true },
    );
    if (result.error) throw result.error;
  }
}
