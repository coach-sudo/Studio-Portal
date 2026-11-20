import type { Lesson } from "./model";
import { z } from "zod";
export const lessonPaymentContextSchema = z
  .object({
    lessonId: z.string().uuid(),
    version: z.number().int().positive(),
    studentId: z.string().uuid(),
    participantId: z.string().uuid().nullable(),
    bookingId: z.string().uuid().nullable(),
    bookingVersion: z.number().int().positive().nullable(),
    currency: z.string().nullable(),
    priceMinor: z.number().int().nullable(),
    paidMinor: z.number().int().nonnegative(),
    remainingMinor: z.number().int().nonnegative(),
    eligible: z.boolean(),
    reasonCode: z.string().nullable(),
    reviewToken: z.string().length(64),
  })
  .strict();
export const lessonPaymentRequestSchema = z
  .object({
    lessonId: z.string().uuid(),
    version: z.number().int().positive(),
    reviewToken: z.string().length(64),
    amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: z.string().regex(/^[A-Z]{3}$/),
    method: z.enum(["cash", "bank"]),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
export const lessonPaymentReceiptSchema = z
  .object({
    receiptId: z.string().uuid(),
    paymentEntryId: z.string().uuid(),
    auditEventId: z.string().uuid(),
    lessonId: z.string().uuid(),
    studentId: z.string().uuid(),
    bookingId: z.string().uuid().nullable(),
    version: z.number().int().positive(),
    amountMinor: z.number().int().positive(),
    paidMinor: z.number().int().positive(),
    remainingMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    queuedSideEffects: z.array(z.never()),
  })
  .strict();
export type LessonPaymentContext = z.infer<typeof lessonPaymentContextSchema>;
export type LessonPaymentRequest = z.infer<typeof lessonPaymentRequestSchema>;
export type LessonPaymentReceipt = z.infer<typeof lessonPaymentReceiptSchema>;
export const paymentReviewMessage = (code: string | null) =>
  ({
    use_invoice: "Record this payment through the linked invoice.",
    checkout_pending:
      "An online payment is pending. Review it before recording money.",
    allocation_review:
      "This lesson has shared or ambiguous ownership. Review its financial allocation first.",
    credit_review:
      "A credit record is attached. Use the credit or invoice actions.",
    correction_review:
      "Finish the financial review of the date correction first.",
    provider_review:
      "This booking uses provider billing. Review its payment agreement first.",
    historical_totals_review:
      "Existing paid totals need ledger review. No money or history was changed.",
    currency_review: "Confirm the studio currency before recording a payment.",
    price_or_status_review:
      "The lesson price or financial status needs review. This action does not reprice, waive or refund lessons.",
    no_balance: "There is no remaining balance to record.",
    outcome_review: "This lesson outcome needs financial review first.",
    student_unavailable: "The original student record is unavailable.",
  })[code ?? ""] ??
  "Review this lesson's financial records before recording a payment.";

export function lessonBillingStatus(lesson: Lesson) {
  if (lesson.paymentNeedsReview) return "Needs studio review";
  if (lesson.status === "cancelled" || lesson.status === "late_cancelled")
    return "Canceled";
  if (lesson.invoicePaymentPending) return "Processing";
  switch (lesson.paymentStatus) {
    case "waived":
      return "No payment required";
    case "paid":
      return "Paid";
    case "paid_by_credit":
      return "Covered by package";
    case "refunded":
      return "Refunded";
    case "due":
    case "partially_paid":
      return "Payment needed";
    default:
      return "Needs studio review";
  }
}

export function canRecordDirectLessonPayment(lesson: Lesson) {
  return (
    lessonBillingStatus(lesson) === "Payment needed" &&
    ["scheduled", "completed"].includes(lesson.status) &&
    !lesson.invoiceId &&
    !lesson.packageId &&
    (lesson.priceMinor ?? 0) > (lesson.paidMinor ?? 0)
  );
}
