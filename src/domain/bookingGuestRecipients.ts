import {
  isFinancialIntent,
  type RecipientIntent,
  type RecipientResolution,
} from "./notificationRecipients";
/** Before a booking is linked to a student, only its explicit guest/guardian identities
 * can receive booking logistics or billing. This never grants private work access. */
export function resolveBookingGuestRecipients(
  booking: {
    for_minor: boolean;
    guest_email: string;
    guardian_email: string | null;
  },
  intent: RecipientIntent,
): RecipientResolution {
  const result: RecipientResolution = {
    recipients: [],
    suppressed: [],
    unresolved: [],
  };
  if (["assignment", "lesson_content"].includes(intent)) {
    result.unresolved.push(
      "A linked identity with work permission is required.",
    );
    return result;
  }
  const emails = isFinancialIntent(intent)
    ? [booking.for_minor ? booking.guardian_email : booking.guest_email]
    : [booking.guest_email, booking.guardian_email];
  for (const email of emails) {
    if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      continue;
    const normalized = email.trim().toLowerCase();
    if (!result.recipients.some((item) => item.email === normalized))
      result.recipients.push({
        email: normalized,
        source:
          normalized === booking.guest_email.trim().toLowerCase()
            ? "student"
            : "linked_contact",
        reason: isFinancialIntent(intent)
          ? booking.for_minor
            ? "Guardian explicitly supplied for this booking"
            : "Adult booking guest"
          : "Identity explicitly supplied for this booking",
      });
  }
  if (booking.for_minor && isFinancialIntent(intent))
    result.suppressed.push({
      source: "student",
      reason: "Minor never receives billing communication.",
    });
  if (!result.recipients.length)
    result.unresolved.push("No eligible booking recipient is configured.");
  return result;
}
