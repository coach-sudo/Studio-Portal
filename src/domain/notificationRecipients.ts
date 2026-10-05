import type { LinkedContact, NotificationPreferences, Student } from "./model";
import { paymentResponsibility } from "./paymentResponsibility";

export const recipientIntents = [
  "lesson_confirmation",
  "lesson_reminder",
  "schedule_change",
  "cancellation",
  "lesson_content",
  "assignment",
  "payment_due",
  "payment_failed",
  "payment_past_due",
  "receipt",
  "package_low",
  "package_shortfall",
  "package_expiration",
  "account_access",
] as const;
export type RecipientIntent = (typeof recipientIntents)[number];
export interface ResolvedRecipient {
  email: string;
  source: "student" | "linked_contact";
  linkedContactId?: string;
  reason: string;
}
export interface RecipientResolution {
  recipients: ResolvedRecipient[];
  suppressed: {
    source: "student" | "linked_contact";
    linkedContactId?: string;
    reason: string;
  }[];
  unresolved: string[];
}
const category: Record<RecipientIntent, keyof NotificationPreferences> = {
  lesson_confirmation: "scheduleChanges",
  lesson_reminder: "lessonReminders",
  schedule_change: "scheduleChanges",
  cancellation: "scheduleChanges",
  lesson_content: "lessonContent",
  assignment: "assignments",
  payment_due: "payments",
  payment_failed: "payments",
  payment_past_due: "payments",
  receipt: "payments",
  package_low: "packageBalance",
  package_shortfall: "packageBalance",
  package_expiration: "packageBalance",
  account_access: "accountAccess",
};
export const isFinancialIntent = (intent: RecipientIntent) =>
  category[intent] === "payments" || category[intent] === "packageBalance";

/** Pure selection policy shared by evaluation and the server boundary. No permissions are bypassed. */
export function resolveNotificationRecipients(
  student: Student,
  contacts: readonly LinkedContact[],
  intent: RecipientIntent,
  options: { mandatory?: boolean } = {},
): RecipientResolution {
  const result: RecipientResolution = {
    recipients: [],
    suppressed: [],
    unresolved: [],
  };
  const key = category[intent];
  const linked = contacts
    .filter((contact) => contact.studentId === student.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  const finance = isFinancialIntent(intent);
  const work = intent === "lesson_content" || intent === "assignment";
  const scheduling = [
    "lesson_confirmation",
    "lesson_reminder",
    "schedule_change",
    "cancellation",
  ].includes(intent);
  const payer = finance ? paymentResponsibility(student, linked) : undefined;
  if (payer?.needsConfiguration) result.unresolved.push(payer.reason);
  const primaryScheduling = linked.some(
    (contact) => contact.isPrimarySchedulingContact,
  );
  const add = (
    email: string | undefined,
    source: ResolvedRecipient["source"],
    preferences: Student["notificationPreferences"],
    contact?: LinkedContact,
  ) => {
    const metadata = { source, linkedContactId: contact?.id };
    const suppress = (reason: string) =>
      result.suppressed.push({ ...metadata, reason });
    if (!email?.trim()) return suppress("Email address missing.");
    if (contact && (!contact.portalEnabled || !contact.canReceiveNotifications))
      return suppress("Contact access or notifications disabled.");
    if (contact && finance && !contact.canViewFinance)
      return suppress("Financial access not permitted.");
    if (contact && work && !contact.canViewWork)
      return suppress("Work access not permitted.");
    if (contact && scheduling && !contact.canViewSchedule)
      return suppress("Schedule access not permitted.");
    if (!options.mandatory && preferences?.[key] === false)
      return suppress(`Notification preference disabled: ${key}.`);
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
      return suppress("Email address invalid.");
    if (result.recipients.some((recipient) => recipient.email === normalized))
      return suppress("Duplicate normalized address.");
    result.recipients.push({
      email: normalized,
      ...metadata,
      reason: contact
        ? contact.isPrimaryPayer && finance
          ? "Primary payer"
          : contact.isPrimarySchedulingContact && scheduling
            ? "Primary scheduling contact"
            : intent === "payment_past_due" &&
                contact.receivesFinancialEscalations
              ? "Financial escalation contact"
              : "Authorized linked contact"
        : finance
          ? "Adult self-payer"
          : "Student",
    });
  };
  if (!finance || payer?.source === "student")
    add(student.email, "student", student.notificationPreferences);
  else if (student.isMinor)
    result.suppressed.push({
      source: "student",
      reason: "Finance communication is not directed to a minor.",
    });
  for (const contact of linked) {
    if (
      finance &&
      contact.id !== payer?.contactId &&
      !(intent === "payment_past_due" && contact.receivesFinancialEscalations)
    )
      continue;
    if (scheduling && primaryScheduling && !contact.isPrimarySchedulingContact)
      continue;
    add(
      contact.email,
      "linked_contact",
      contact.notificationPreferences,
      contact,
    );
  }
  if (!result.recipients.length)
    result.unresolved.push("No eligible recipient remains for this event.");
  return result;
}
