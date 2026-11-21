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
    "invoice_issued",
  );
  const issueError = payer.needsConfiguration ? payer.reason : undefined;
  const deliveryError =
    issueError ??
    (!delivery.recipients.some((recipient) => recipient.email === payer.email)
      ? (delivery.suppressed.find(
          (entry) => entry.linkedContactId === payer.contactId,
        )?.reason ?? "Invoice email is unavailable for this payer.")
      : undefined);
  return {
    recipient: {
      name: payer.name ?? "Payer not configured",
      email: payer.email,
      ...(payer.contactId ? { studentName: student.fullName } : {}),
    },
    recipients: deliveryError
      ? []
      : delivery.recipients.map((recipient) => recipient.email),
    issueError,
    deliveryError,
  };
}
