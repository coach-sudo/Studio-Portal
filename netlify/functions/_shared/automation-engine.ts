import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import {
  evaluateAutomationRule,
  automationRuleLabels,
  type AutomationEntity,
} from "../../../src/domain/automationRules";
import { resolveNotificationRecipients } from "../../../src/domain/notificationRecipients";
import type {
  Database,
  Json,
  Tables,
} from "../../../src/types/database.generated";
import { mapAutomationRule } from "./automation-config";
import { loadOperationalData } from "./operational-data";
import { queuePresentedMessages } from "./outbox-queue";
import { portalActionUrl, portalOrigin } from "./portal-url";
import type { RecipientIntent } from "../../../src/domain/notificationRecipients";
import type { ReadinessData } from "../../../src/domain/lessonReadiness";
import { bookingForLesson } from "../../../src/domain/packageForecast";
import { AppError } from "./http";

/** Queue only. Gmail delivery remains exclusively owned by the existing outbox worker. */
export async function evaluateAndQueueRule(
  client: SupabaseClient,
  row: Tables<"automation_rules">,
  entityId: string,
  studentId: string,
  correlationId: string,
  preview = false,
  now = Date.now(),
  options: { data?: ReadinessData; workerWindow?: number } = {},
) {
  const db = client as SupabaseClient<Database>,
    rule = mapAutomationRule(row);
  const data =
    options.data ??
    (await loadOperationalData(client, row.studio_id, studentId));
  const entity: AutomationEntity = rule.key.startsWith("package_")
    ? { package: data.packages.find((item) => item.id === entityId) }
    : rule.key === "delivery_failure"
      ? { message: data.outbox.find((item) => item.id === entityId) }
      : { lesson: data.lessons.find((item) => item.id === entityId) };
  if (!entity.lesson && !entity.package && !entity.message)
    throw AppError.forbidden();
  const decision = evaluateAutomationRule(rule, entity, data, now);
  const studioResult = await db
    .from("studios")
    .select("name,settings")
    .eq("id", row.studio_id)
    .single();
  if (studioResult.error) throw studioResult.error;
  const studio = studioResult.data,
    settings = studio.settings as {
      coachName?: string;
      contactEmail?: string;
      branding?: { logoUrl?: string };
    };
  const coachResult = await db
    .from("memberships")
    .select("user_id")
    .eq("studio_id", row.studio_id)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();
  if (coachResult.error) throw coachResult.error;
  // Coach alerts go to an established coach Auth identity, never an arbitrary form address.
  const coachUser = coachResult.data
    ? await db.auth.admin.getUserById(coachResult.data.user_id)
    : null;
  if (coachUser?.error) throw coachUser.error;
  const resolution =
    rule.audience === "coach"
      ? {
          recipients: coachUser?.data.user?.email
            ? [
                {
                  email: coachUser.data.user.email,
                  name: settings.coachName ?? "Coach",
                  kind: "coach",
                },
              ]
            : [],
          suppressed: [],
          unresolved: coachUser?.data.user?.email
            ? []
            : ["coach_email_unavailable"],
        }
      : resolveNotificationRecipients(
          data.students[0],
          data.linkedContacts,
          rule.audience as RecipientIntent,
        );
  const origin = portalOrigin(),
    action = rule.key.startsWith("package_")
      ? { label: "View packages", url: portalActionUrl(origin, "packages") }
      : rule.key.startsWith("payment_")
        ? { label: "Pay balance", url: portalActionUrl(origin, "payments") }
        : {
            label: "View lesson",
            url: portalActionUrl(origin, "lesson", entity.lesson?.id),
          };
  const outboxIds: string[] = [];
  if (!preview && decision.eligible)
    for (const stage of decision.stages) {
      const recipients = stage.coachEscalation
        ? coachUser?.data.user?.email
          ? [{ email: coachUser.data.user.email, name: "Coach", kind: "coach" }]
          : []
        : resolution.recipients;
      for (const recipient of recipients) {
        const booking = entity.lesson && bookingForLesson(entity.lesson, data);
        const email = recipient.email.toLowerCase();
        // Event producers and explicit rule runs share idempotency for the existing library.
        const key =
          rule.key === "booking_confirmation" && booking
            ? `booking:${booking.id}:confirmed:student:${email}`
            : rule.key === "lesson_reminder" &&
                entity.lesson &&
                stage.key.startsWith("hours-")
              ? `lesson:${entityId}:starts:${entity.lesson.startsAt}:reminder:${stage.key.slice(6)}:${email}`
              : rule.key === "payment_failed" && booking
                ? `booking:${booking.id}:payment-failed:${email}`
                : `automation:${rule.key}:${entityId}:${entity.lesson?.startsAt ?? entity.package?.expiresAt ?? entity.message?.updatedAt ?? "initial"}:${stage.key}:${email}`;
        const queued = await queuePresentedMessages(
          client,
          [
            {
              studio_id: row.studio_id,
              student_id: studentId,
              lesson_id: entity.lesson?.id,
              booking_id: booking?.id,
              channel: "email",
              recipient: recipient.email,
              subject: rule.template.subject || automationRuleLabels[rule.key],
              body:
                rule.template.body ||
                `Hi there,\n\n${decision.explanation}\n\nPlease open the portal for the details.`,
              status: rule.mode === "draft" ? "draft" : "queued",
              send_at: stage.sendAt,
              next_attempt_at: stage.sendAt,
              dedupe_key: key,
              event_key: `automation.${rule.key}.${stage.key}`,
              priority: rule.priority,
              automation_rule_id: rule.id,
              recipient_intent:
                stage.coachEscalation || rule.audience === "coach"
                  ? "coach"
                  : rule.audience,
              correlation_id: correlationId,
              entity_snapshot: {
                entityId,
                startsAt: entity.lesson?.startsAt,
                endsAt: entity.lesson?.endsAt,
                stage: stage.key,
                ruleVersion: rule.version,
              } as Json,
            },
          ],
          { name: studio.name, settings },
          origin,
          stage.coachEscalation
            ? {
                label: "Review lesson",
                url: `${origin}/coach/students/${studentId}/lessons/${entityId}`,
              }
            : { ...action, label: rule.template.ctaLabel || action.label },
        );
        outboxIds.push(...queued.map((item) => item.id));
      }
    }
  const result = preview
    ? "not_due"
    : !decision.eligible
      ? "suppressed"
      : !resolution.recipients.length
        ? "unresolved"
        : outboxIds.length
          ? rule.mode === "draft"
            ? "draft"
            : "queued"
          : "duplicate";
  const evidence = {
    trigger: rule.trigger,
    conditions: rule.conditions,
    mode: rule.mode,
    financialState: decision.financialState ?? null,
    recipients: resolution.recipients,
    suppressedRecipients: resolution.suppressed,
    unresolvedRecipients: resolution.unresolved,
    preview,
    stages: decision.stages,
  };
  // A stable state fingerprint avoids filling history with identical worker evaluations.
  const decisionKey = createHash("sha256")
    .update(
      `${rule.id}:${rule.version}:${entityId}:${preview ? correlationId : JSON.stringify({ window: options.workerWindow, result, reason: decision.suppressedReason, financial: decision.financialState, state: entity.lesson?.updatedAt ?? entity.package?.updatedAt ?? entity.message?.updatedAt, studentUpdatedAt: data.students[0].updatedAt, contacts: data.linkedContacts.map((c) => [c.id, c.updatedAt]), stages: decision.stages.map((s) => s.key) })}`,
    )
    .digest("hex");
  const recorded = await db.from("automation_runs").upsert(
    {
      studio_id: row.studio_id,
      rule_id: row.id,
      entity_type: entity.package
        ? "package"
        : entity.message
          ? "outbox"
          : "lesson",
      entity_id: entityId,
      result,
      explanation: decision.explanation,
      suppressed_reason:
        decision.suppressedReason ??
        (!resolution.recipients.length ? "recipient_unresolved" : null),
      outbox_ids: outboxIds,
      correlation_id: correlationId,
      decision: evidence as Json,
      decision_key: decisionKey,
    },
    { onConflict: "decision_key", ignoreDuplicates: true },
  );
  if (recorded.error) throw recorded.error;
  return { decision, result, recipients: resolution, outboxIds, action };
}

export async function evaluateStudioAutomations(
  client: SupabaseClient,
  studioId: string,
  correlationId: string,
  deadline = Date.now() + 10_000,
) {
  const db = client as SupabaseClient<Database>;
  const rulesResult = await db
    .from("automation_rules")
    .select("*")
    .eq("studio_id", studioId)
    .eq("enabled", true)
    .neq("mode", "off");
  if (rulesResult.error) throw rulesResult.error;
  let evaluated = 0;
  const now = Date.now();
  const dataCache = new Map<string, ReadinessData>();
  for (const rule of rulesResult.data) {
    if (Date.now() >= deadline || evaluated >= 8) break;
    // Existing event producers own confirmation/reminder/failure idempotency during compatibility.
    if (
      [
        "booking_confirmation",
        "lesson_reminder",
        "payment_failed",
        "package_low",
        "package_expiration",
      ].includes(rule.rule_key)
    )
      continue;
    // Rotate beyond the first page rather than re-evaluating the same first forty rows.
    const recent = await db
      .from("automation_runs")
      .select("entity_id")
      .eq("rule_id", rule.id)
      .gte("evaluated_at", new Date(now - 20 * 60_000).toISOString())
      .limit(1000);
    if (recent.error) throw recent.error;
    const ids = [...new Set(recent.data.map((run) => run.entity_id))];
    let query = rule.rule_key.startsWith("package_")
      ? db
          .from("packages")
          .select("id,student_id,students!inner(studio_id)")
          .eq("students.studio_id", studioId)
          .order("id")
      : rule.rule_key === "delivery_failure"
        ? db
            .from("outbox_messages")
            .select("id,student_id")
            .eq("studio_id", studioId)
            .eq("status", "failed")
            .not("student_id", "is", null)
            .order("id")
        : db
            .from("lessons")
            .select("id,student_id")
            .eq("studio_id", studioId)
            .eq("status", "scheduled")
            .gte(
              "starts_at",
              new Date(
                now -
                  (rule.rule_key === "payment_past_due" ? 30 * 86400000 : 0),
              ).toISOString(),
            )
            .lte(
              "starts_at",
              new Date(Date.now() + 30 * 86400000).toISOString(),
            )
            .order("id");
    if (ids.length) query = query.not("id", "in", `(${ids.join(",")})`);
    const entities = await query.limit(4);
    if (entities.error) throw entities.error;
    for (const entity of entities.data)
      if (entity.student_id) {
        if (Date.now() >= deadline || evaluated >= 8) break;
        let data = dataCache.get(entity.student_id);
        if (!data) {
          data = await loadOperationalData(client, studioId, entity.student_id);
          dataCache.set(entity.student_id, data);
        }
        await evaluateAndQueueRule(
          client,
          rule,
          entity.id,
          entity.student_id,
          correlationId,
          false,
          now,
          { data, workerWindow: Math.floor(now / (20 * 60_000)) },
        );
        evaluated++;
      }
  }
  return { evaluated };
}
