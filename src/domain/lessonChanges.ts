import { z } from "zod";
export const lessonChangeRequest = z
  .object({
    action: z.enum(["cancel", "reschedule"]),
    scope: z
      .enum(["occurrence", "selected", "future", "series"])
      .default("occurrence"),
    selectedIds: z.array(z.string().uuid()).min(1).max(100).optional(),
    studentContextId: z.string().uuid().optional(),
    wholeClass: z.boolean().default(false),
    useCredit: z.boolean().default(false),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    allowConflict: z.boolean().optional(),
    reviewToken: z.string().length(64).optional(),
  })
  .superRefine((v, ctx) => {
    if (
      v.action === "reschedule" &&
      (!v.startsAt ||
        !v.endsAt ||
        Date.parse(v.endsAt) <= Date.parse(v.startsAt))
    )
      ctx.addIssue({ code: "custom", message: "Choose a valid lesson time." });
    if (v.scope === "selected" && !v.selectedIds)
      ctx.addIssue({
        code: "custom",
        message: "Select the occurrences to review.",
      });
    if (v.wholeClass && v.studentContextId)
      ctx.addIssue({
        code: "custom",
        message: "Open the class from the studio calendar.",
      });
  });
export type LessonChangeReview = {
  reviewToken: string;
  count: number;
  stopsFutureGeneration: boolean;
  creditPolicy: "return" | "retain";
  items: {
    lessonId: string;
    topic: string;
    version: number;
    startsAt: string;
    newStartsAt?: string;
    status: string;
    eligible: boolean;
    reasonCode?: string;
    reservedCredits: number;
    notificationParticipantCount: number;
    providerLinked: boolean;
    bookings: { id: string; shared: boolean; unaffectedActive: number }[];
  }[];
};
export const lessonChangeReasons: Record<string, string> = {
  lesson_not_scheduled:
    "Only scheduled occurrences can change. Historical records remain intact.",
  class_scope_required:
    "Open the class in the studio calendar and review a whole-class change.",
  payment_pending:
    "Check or cancel the pending invoice or booking payment first.",
  shared_invoice_review_required:
    "This invoice line covers multiple occurrences. Review its allocation at invoice level.",
  shared_prepaid_review_required:
    "This prepaid booking covers multiple occurrences. Review settlement at booking level.",
  synchronization_review_required:
    "Resolve the provider synchronization conflict first.",
  reconciliation_required:
    "The payment and credit evidence needs review before this change.",
  reserved_credit_expires:
    "The reserved credit expires before the new lesson time. Return it and review coverage first.",
};
