import type { LinkedContact, Student } from "./model";

export interface PaymentResponsibility {
  contactId?: string;
  name?: string;
  email?: string;
  source: "primary_payer" | "student" | "fallback" | "unresolved";
  needsConfiguration: boolean;
  reason: string;
}

/** Permission permits delivery; responsibility chooses the intended payer. No email guessing. */
export function paymentResponsibility(
  student: Student,
  contacts: readonly LinkedContact[],
): PaymentResponsibility {
  const linked = contacts.filter((contact) => contact.studentId === student.id);
  const primary = linked.filter((contact) => contact.isPrimaryPayer);
  if (primary.length > 1)
    return {
      source: "unresolved",
      needsConfiguration: true,
      reason: "More than one primary payer is configured.",
    };
  if (primary[0]) {
    const contact = primary[0];
    const missing = [
      !contact.portalEnabled && "portal access",
      !contact.canViewFinance && "permission to view billing",
      !contact.email?.trim() && "an email address",
    ].filter((detail): detail is string => typeof detail === "string");
    if (missing.length) {
      return {
        contactId: contact.id,
        name: contact.fullName,
        source: "unresolved",
        needsConfiguration: true,
        reason: `The primary payer needs ${new Intl.ListFormat("en", { type: "conjunction" }).format(missing)}.`,
      };
    }
    return {
      contactId: contact.id,
      name: contact.fullName,
      email: contact.email.trim().toLowerCase(),
      source: "primary_payer",
      needsConfiguration: false,
      reason: "Designated primary payer.",
    };
  }
  if (!student.isMinor && student.email?.trim())
    return {
      name: student.fullName,
      email: student.email.trim().toLowerCase(),
      source: "student",
      needsConfiguration: false,
      reason: "Adult student is the self-payer.",
    };
  const fallback = linked
    .filter(
      (contact) =>
        contact.portalEnabled &&
        contact.canViewFinance &&
        contact.email?.trim(),
    )
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (fallback)
    return {
      contactId: fallback.id,
      name: fallback.fullName,
      email: fallback.email.trim().toLowerCase(),
      source: "fallback",
      needsConfiguration: true,
      reason:
        "An authorized finance contact is available; designate the primary payer.",
    };
  return {
    source: "unresolved",
    needsConfiguration: true,
    reason: student.isMinor
      ? "A minor needs a linked payer with financial access."
      : "Add a payer email or a primary finance contact.",
  };
}
