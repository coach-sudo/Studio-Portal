import type { LinkedContact, Student } from "./model";
import { paymentResponsibility } from "./paymentResponsibility";
import { resolveNotificationRecipients } from "./notificationRecipients";

export function invoiceBilling(
  student: Student,
  contacts: readonly LinkedContact[],
) {
  const payer = paymentResponsibility(student, contacts);
  const delivery = resolveNotificationRecipients(
    student,
    contacts,
    "payment_due",
  );
  const issueError = payer.needsConfiguration
    ? payer.reason
    : !delivery.recipients.some((recipient) => recipient.email === payer.email)
      ? "The payer cannot receive invoice emails. Check their financial access and payment notification settings."
      : undefined;
  return {
    recipient: {
      name: payer.name ?? "Payer not configured",
      email: payer.email,
      ...(payer.contactId ? { studentName: student.fullName } : {}),
    },
    recipients: issueError
      ? []
      : delivery.recipients.map((recipient) => recipient.email),
    issueError,
  };
}
