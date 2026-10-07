import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Drawer, Section } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { evaluateLessonReadiness } from "../../domain/lessonReadiness";
import { formatMoney } from "../../domain/finance";
import type {
  Lesson,
  OutboxMessage,
  Student,
  StudioSnapshot,
} from "../../domain/model";
import {
  lessonPaymentReminders,
  paymentReminderRequired,
  paymentReminderMatchesBalance,
} from "../../domain/paymentReminder";
import { formatStudioDateTime } from "../../domain/presentation";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { supabase } from "../../lib/supabase";
import type { AutomationDecision } from "../../domain/automationRules";
import { demoRules } from "./automation/demoRules";

type Preview = {
  decision: AutomationDecision;
  recipients: {
    recipients: { name: string; email: string }[];
    unresolved: string[];
  };
};

export function PaymentReminderSteps({
  data,
  student,
  isDemo,
  now = Date.now(),
}: {
  data: StudioSnapshot;
  student: Student;
  isDemo: boolean;
  now?: number;
}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<Lesson>();
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const rules = useQuery({
    queryKey: [
      "studio-page",
      "administration",
      "automation-rules",
      data.studioId,
    ],
    enabled: !isDemo && Boolean(supabase),
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      const result = await supabase!
        .from("automation_rules")
        .select("*")
        .eq("studio_id", data.studioId)
        .order("priority", { ascending: false })
        .order("rule_key")
        .abortSignal(signal);
      if (result.error) throw result.error;
      return result.data;
    },
  });
  const messages = useQuery({
    queryKey: [
      "studio-page",
      "messaging",
      "payment-reminders",
      data.studioId,
      student.id,
    ],
    enabled: !isDemo && Boolean(supabase),
    refetchInterval: 30000,
    queryFn: async ({ signal }) => {
      const result = await supabase!
        .from("outbox_messages")
        .select("*")
        .eq("studio_id", data.studioId)
        .eq("student_id", student.id)
        .or(
          "event_key.like.automation.payment_due.%,event_key.like.automation.payment_past_due.%,event_key.like.payment.due.%,event_key.like.payment.past_due.%",
        )
        .order("updated_at", { ascending: false })
        .limit(100)
        .abortSignal(signal);
      if (result.error) throw result.error;
      return result.data.map((row): OutboxMessage => ({
        id: row.id,
        version: row.version,
        updatedAt: row.updated_at,
        studentId: row.student_id ?? undefined,
        lessonId: row.lesson_id ?? undefined,
        recipientIntent: row.recipient_intent ?? undefined,
        channel: "email",
        recipient: row.recipient,
        subject: row.subject,
        body: row.body,
        status: row.status,
        attempts: row.attempts,
        sendAt: row.send_at ?? undefined,
        eventKey: row.event_key ?? undefined,
        suppressionReason: row.suppression_reason ?? undefined,
        approvedAt: (row.entity_snapshot as { approvedAt?: string } | null)
          ?.approvedAt,
        quotedAmountDueMinor: (
          row.entity_snapshot as { amountDueMinor?: number } | null
        )?.amountDueMinor,
      }));
    },
  });
  const items = data.lessons
    .filter(
      (lesson) =>
        lesson.studentId === student.id &&
        lesson.status === "scheduled" &&
        Date.parse(lesson.startsAt) > now,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 5);
  const outbox = isDemo ? data.outbox : (messages.data ?? []);
  const availableRules = isDemo ? demoRules(data) : (rules.data ?? []);
  const selectedRule =
    selected &&
    availableRules.find(
      (rule) =>
        rule.rule_key ===
        (evaluateLessonReadiness(selected, data, now).financial.state ===
        "past_due"
          ? "payment_past_due"
          : "payment_due"),
    );

  async function evaluate(lesson: Lesson, queue = false) {
    setBusy(true);
    setNotice("");
    if (!queue) {
      setSelected(lesson);
      setPreview(undefined);
    }
    try {
      if (isDemo)
        throw new Error(
          "Demo does not prepare or send email. Connect the coach workspace to review real recipients.",
        );
      const rule = availableRules.find(
        (row) =>
          row.rule_key ===
          (evaluateLessonReadiness(lesson, data, now).financial.state ===
          "past_due"
            ? "payment_past_due"
            : "payment_due"),
      );
      if (!rule) throw new Error("Configure a payment reminder rule first.");
      const result = await studioCommand("automations", {
        command: queue ? "run_rule" : "test_rule",
        entityId: rule.id,
        expectedVersion: rule.version,
        reason: "Coach reviewed upcoming lesson payment reminder",
        payload: { studentId: student.id, entityId: lesson.id },
      });
      if (queue) {
        setNotice(
          result.resource.result === "draft"
            ? "Reminder drafts prepared. Review and approve each scheduled delivery below."
            : `Evaluation: ${result.resource.result}. ${result.resource.decision.explanation}`,
        );
        setSelected(undefined);
        await invalidateStudioDomains(client, ["messaging"]);
      } else setPreview(result.resource);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Reminder could not be evaluated.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function approve(message: OutboxMessage) {
    setBusy(true);
    setNotice("");
    try {
      if (isDemo) throw new Error("Demo never sends email.");
      await studioCommand("automations", {
        command: "approve_message",
        entityId: message.id,
        expectedVersion: message.version,
        reason: "Coach approved scheduled payment reminder",
      });
      setNotice(
        "Reminder approved. Its scheduled time is retained; payment and recipient checks run again before delivery.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Approval failed.");
    } finally {
      await invalidateStudioDomains(client, [
        "messaging",
        "finance",
        "lessons",
        "booking",
      ]);
      setBusy(false);
    }
  }
  return (
    <Section title="Payment next steps" marked>
      <p>
        Review the next five upcoming lessons. Reminders require coach approval.
        Payment or package coverage is checked again before delivery.
      </p>
      {notice && <p role="status">{notice}</p>}
      {(rules.isError || messages.isError) && (
        <p role="alert">
          Reminder state could not be loaded.{" "}
          <button
            onClick={() => {
              void rules.refetch();
              void messages.refetch();
            }}
          >
            Retry
          </button>
        </p>
      )}
      {!items.length && <p>No upcoming lessons need review.</p>}
      {items.map((lesson) => {
        const readiness = evaluateLessonReadiness(lesson, data, now);
        const required = paymentReminderRequired(readiness);
        const reminders = lessonPaymentReminders(lesson, outbox);
        const currentReminders = reminders.filter(
          (message) =>
            paymentReminderMatchesBalance(
              message,
              readiness.financial.amountDueMinor,
            ) &&
            !(
              message.status === "cancelled" &&
              message.suppressionReason === "financial_amount_changed"
            ),
        );
        const rule = availableRules.find(
          (row) =>
            row.rule_key ===
            (readiness.financial.state === "past_due"
              ? "payment_past_due"
              : "payment_due"),
        );
        return (
          <article className="communication-card" key={lesson.id}>
            <strong>
              {lesson.topic} ·{" "}
              {formatStudioDateTime(lesson.startsAt, data.settings.timezone)}
            </strong>
            <p>
              {readiness.financial.reason}
              {required
                ? ` ${formatMoney(readiness.financial.amountDueMinor, data.settings.currency)} remains due.`
                : ""}
            </p>
            {required && !lesson.packageId && (
              <p>
                No package attached to this upcoming lesson. Review a payment
                reminder or assign coverage.
              </p>
            )}
            {reminders.map((message) => (
              <div
                key={message.id}
                className="communication-card"
                data-message-id={message.id}
              >
                <p>
                  {!paymentReminderMatchesBalance(
                    message,
                    readiness.financial.amountDueMinor,
                  ) && required
                    ? "Balance changed — review a fresh reminder"
                    : message.status === "draft" ||
                        (message.status === "queued" && !message.approvedAt)
                      ? "Awaiting coach approval"
                      : message.status === "sent"
                        ? "Reminder sent"
                        : message.status === "sending"
                          ? "Reminder sending"
                          : message.status === "failed"
                            ? "Reminder failed — review delivery"
                            : message.status === "cancelled"
                              ? "Reminder cancelled"
                              : "Reminder scheduled to be sent"}
                  {message.sendAt &&
                  paymentReminderMatchesBalance(
                    message,
                    readiness.financial.amountDueMinor,
                  ) &&
                  ["draft", "approved", "queued"].includes(message.status)
                    ? ` on ${formatStudioDateTime(message.sendAt, data.settings.timezone)}`
                    : ""}{" "}
                  · {message.recipient}
                </p>
                {(message.status === "draft" ||
                  (message.status === "queued" && !message.approvedAt)) &&
                  required &&
                  paymentReminderMatchesBalance(
                    message,
                    readiness.financial.amountDueMinor,
                  ) && (
                    <>
                      <pre className="communication-preview">
                        {message.body}
                      </pre>
                      <button
                        type="button"
                        disabled={busy || isDemo}
                        onClick={() => void approve(message)}
                      >
                        Approve scheduled reminder
                      </button>
                    </>
                  )}
                {message.status === "failed" && (
                  <Link to={`/coach/students/${student.id}/account`}>
                    Review delivery and retry
                  </Link>
                )}
              </div>
            ))}
            <div className="form-actions">
              {required && (
                <a href="#payment-arrangements">Assign / review package</a>
              )}
              <Link to={`/coach/students/${student.id}/lessons/${lesson.id}`}>
                Open lesson
              </Link>
              {required &&
                !currentReminders.length &&
                !rules.isError &&
                !messages.isError &&
                (rule?.enabled &&
                rule.mode !== "off" &&
                data.settings.emailAutomations.enabled ? (
                  <button
                    type="button"
                    disabled={busy || (!isDemo && messages.isPending)}
                    onClick={() => void evaluate(lesson)}
                  >
                    Review payment reminder
                  </button>
                ) : (
                  <Link to="/coach/settings?panel=email">
                    Configure payment reminders
                  </Link>
                ))}
              {!required &&
                ["unknown", "review_required"].includes(
                  readiness.financial.state,
                ) && (
                  <Link to={`/coach/students/${student.id}/account`}>
                    Review financial setup
                  </Link>
                )}
            </div>
          </article>
        );
      })}
      {selected && (
        <Drawer
          title="Review payment reminder"
          onClose={() => {
            setSelected(undefined);
          }}
        >
          {busy && (
            <p role="status">Checking current coverage and recipients…</p>
          )}
          {notice && <p role="alert">{notice}</p>}
          {preview && (
            <>
              <p>{preview.decision.explanation}</p>
              <p>
                Recipients:{" "}
                {preview.recipients.recipients
                  .map((recipient) => `${recipient.name} (${recipient.email})`)
                  .join(", ") || "No eligible payer"}
              </p>
              {preview.decision.stages
                .filter((stage) => !stage.coachEscalation)
                .map((stage) => (
                  <p key={stage.key}>
                    Proposed reminder:{" "}
                    {formatStudioDateTime(stage.sendAt, data.settings.timezone)}
                  </p>
                ))}
              {preview.recipients.unresolved.length > 0 && (
                <p>Recipient configuration needs review before sending.</p>
              )}
              <p>
                {selectedRule?.mode === "off"
                  ? "Enable the payment rule in Settings first."
                  : "Prepare drafts, then review the exact message and approve each scheduled delivery."}
              </p>
            </>
          )}
          <div className="form-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setSelected(undefined)}
            >
              Done
            </button>
            {preview?.decision.eligible &&
              preview.recipients.recipients.length > 0 && (
                <button
                  className="primary"
                  type="button"
                  disabled={busy}
                  onClick={() => void evaluate(selected, true)}
                >
                  Prepare reminder drafts
                </button>
              )}
          </div>
        </Drawer>
      )}
    </Section>
  );
}
