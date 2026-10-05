import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  TablesInsert,
} from "../../../src/types/database.generated";
import type { AutomationRuleKey } from "../../../src/domain/automationRules";
import { presentOutboxMessage, type EmailStudio } from "./outbox-presentation";
import { renderEmailTemplate } from "./email-templates";

export async function compatibleRule(
  client: SupabaseClient,
  studioId: string,
  key: AutomationRuleKey,
) {
  const db = client as SupabaseClient<Database>;
  const result = await db
    .from("automation_rules")
    .select("*")
    .eq("studio_id", studioId)
    .eq("rule_key", key)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}
export function compatibleQueueStatus(
  rule: Awaited<ReturnType<typeof compatibleRule>>,
  legacyEnabled = true,
): "draft" | "queued" | undefined {
  if (rule)
    return !rule.enabled || rule.mode === "off"
      ? undefined
      : rule.mode === "draft"
        ? "draft"
        : "queued";
  return legacyEnabled ? "queued" : undefined;
}
export async function queuePresentedMessages(
  client: SupabaseClient,
  messages: TablesInsert<"outbox_messages">[],
  studio: EmailStudio,
  origin: string,
  action?: { label: string; url: string },
  templateVariables: Record<string, string> = {},
) {
  if (!messages.length) return [];
  const db = client as SupabaseClient<Database>;
  const ruleIds = [
    ...new Set(
      messages
        .map((message) => message.automation_rule_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const rules = ruleIds.length
    ? await db.from("automation_rules").select("id,template").in("id", ruleIds)
    : { data: [], error: null };
  if (rules.error) throw rules.error;
  const decorated = messages.map((message) => {
    const template = rules.data?.find(
      (rule) => rule.id === message.automation_rule_id,
    )?.template as
      { subject?: string; body?: string; ctaLabel?: string } | undefined;
    const variables = {
      studioName: studio.name,
      studentName: message.body?.match(/^Hi ([^,\n]+)/)?.[1] ?? "there",
      manageUrl: action?.url ?? origin,
      renewUrl: action?.url ?? origin,
      ...templateVariables,
      hours:
        message.dedupe_key?.match(/:reminder:([0-9.]+):/)?.[1] ??
        templateVariables.hours ??
        "",
    };
    const content = {
      ...message,
      subject: template?.subject
        ? renderEmailTemplate(template.subject, variables)
        : message.subject,
      body: template?.body
        ? renderEmailTemplate(template.body, variables)
        : message.body,
    };
    const presented = presentOutboxMessage(
      content,
      studio,
      origin,
      action
        ? { ...action, label: template?.ctaLabel || action.label }
        : action,
    );
    return { ...content, body: presented.text, html_body: presented.html };
  });
  // The established dedupe index is partial (WHERE dedupe_key IS NOT NULL).
  // PostgREST upsert cannot infer that predicate. Ordinary INSERT uses the same
  // atomic unique constraint; ignore only that index's duplicate rejection.
  // Individual inserts also preserve defaults on heterogeneous producer rows.
  const queuedRows: {
    id: string;
    status: string;
    event_key: string | null;
    dedupe_key: string | null;
  }[] = [];
  for (const message of decorated) {
    const inserted = await db
      .from("outbox_messages")
      .insert(message)
      .select("id,status,event_key,dedupe_key")
      .single();
    if (inserted.error) {
      if (
        inserted.error.code === "23505" &&
        inserted.error.message.includes("outbox_messages_dedupe_idx")
      )
        continue;
      throw inserted.error;
    }
    queuedRows.push(inserted.data);
  }
  for (const message of messages)
    if (message.automation_rule_id) {
      const queued = queuedRows.find(
        (item) => item.dedupe_key === message.dedupe_key,
      );
      const recorded = await db.from("automation_runs").upsert(
        {
          studio_id: message.studio_id,
          rule_id: message.automation_rule_id,
          entity_type: message.lesson_id
            ? "lesson"
            : message.booking_id
              ? "booking"
              : "student",
          entity_id:
            message.lesson_id ?? message.booking_id ?? message.student_id!,
          result: queued
            ? message.status === "draft"
              ? "draft"
              : "queued"
            : "duplicate",
          explanation: queued
            ? "Existing event producer queued email using the structured rule and event-aware recipient policy."
            : "Equivalent event email already exists.",
          outbox_ids: queued ? [queued.id] : [],
          correlation_id: message.correlation_id ?? crypto.randomUUID(),
          decision: {
            trigger: message.event_key ?? "event",
            mode: message.status,
            recipient: message.recipient,
            recipientIntent: message.recipient_intent ?? "legacy",
            conditions: "Event producer validated authoritative state",
          },
          decision_key: `producer:${message.dedupe_key}`,
        },
        { onConflict: "decision_key", ignoreDuplicates: true },
      );
      if (recorded.error) throw recorded.error;
    }
  return queuedRows;
}
