import type { Lesson, OutboxMessage } from "./model";
import type { LessonReadiness } from "./lessonReadiness";

export function paymentReminderRequired(readiness: LessonReadiness) {
  return (
    readiness.active &&
    readiness.financial.amountDueMinor > 0 &&
    ["payment_due", "partially_paid", "past_due"].includes(
      readiness.financial.state,
    )
  );
}

/** Match only payer reminders for this occurrence; coach alerts are separate. */
export function lessonPaymentReminders(
  lesson: Lesson,
  messages: OutboxMessage[],
) {
  return messages
    .filter(
      (message) =>
        message.lessonId === lesson.id &&
        message.recipientIntent !== "coach" &&
        /^(?:automation\.)?payment[._](?:due|past_due)/.test(
          message.eventKey ?? "",
        ) &&
        !message.eventKey?.endsWith("coach-escalation"),
    )
    .sort((a, b) =>
      (a.sendAt ?? a.updatedAt).localeCompare(b.sendAt ?? b.updatedAt),
    );
}

export function paymentReminderNeedsApproval(key: string) {
  return key === "payment_due" || key === "payment_past_due";
}
