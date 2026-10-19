import { z } from "zod";

export const creditCoverageReasonSchema = z.enum([
  "eligible",
  "already_reserved",
  "no_available_credits",
  "expires_before_lesson",
  "cash_paid",
  "partially_paid",
  "payment_pending",
  "reconciliation_required",
  "auto_disabled",
  "mixed_settings_review",
  "lesson_ineligible",
]);

export const creditCoverageSchema = z
  .object({
    studentId: z.string().uuid(),
    evaluatedAt: z.iso.datetime({ offset: true }),
    previewEnable: z.boolean(),
    settingReasonCode: z.literal("mixed_settings_review").nullable(),
    lessonsVisible: z.boolean(),
    summary: z.object({
      available: z.number().int(),
      reserved: z.number().int().nonnegative(),
      remaining: z.number().int(),
      expired: z.number().int().nonnegative(),
      version: z.number().int().positive(),
      autoApply: z.boolean().nullable(),
      needsReview: z.boolean(),
    }),
    maintenance: z
      .object({
        pending: z.boolean(),
        requestedVersion: z.number().int().positive(),
        completedVersion: z.number().int().positive().nullable(),
        attempts: z.number().int().nonnegative(),
        lastError: z.string().nullable(),
        updatedAt: z.iso.datetime({ offset: true }),
      })
      .nullable()
      .optional(),
    items: z
      .array(
        z.object({
          lessonId: z.string().uuid(),
          topic: z.string(),
          startsAt: z.iso.datetime({ offset: true }),
          endsAt: z.iso.datetime({ offset: true }),
          version: z.number().int().positive(),
          state: z.enum([
            "covered",
            "eligible_unreserved",
            "ineligible",
            "review_required",
          ]),
          reasonCode: creditCoverageReasonSchema,
          eligible: z.boolean(),
          existingReservation: z.boolean().optional(),
          packageId: z.string().uuid().optional(),
          expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
        }),
      )
      .max(100),
    page: z.number().int().min(1).max(1000000),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative().nullable(),
    hasMore: z.boolean(),
    counts: z
      .object({
        covered: z.number().int().nonnegative(),
        eligible: z.number().int().nonnegative(),
        uncovered: z.number().int().nonnegative(),
        reviewRequired: z.number().int().nonnegative(),
      })
      .nullable(),
  })
  .superRefine((value, context) => {
    if (
      value.summary.remaining !==
      value.summary.available + value.summary.reserved
    )
      context.addIssue({
        code: "custom",
        path: ["summary"],
        message: "Credit totals do not reconcile.",
      });
    if (value.items.length > value.pageSize)
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Coverage exceeds the requested page.",
      });
    if (
      !value.lessonsVisible &&
      (value.items.length ||
        value.counts !== null ||
        value.total !== null ||
        value.hasMore)
    )
      context.addIssue({
        code: "custom",
        path: ["lessonsVisible"],
        message: "Hidden logistics must not be returned.",
      });
    if (
      value.lessonsVisible &&
      (!value.counts ||
        value.total === null ||
        value.counts.covered +
          value.counts.eligible +
          value.counts.uncovered !==
          value.total ||
        value.counts.reviewRequired > value.counts.uncovered)
    )
      context.addIssue({
        code: "custom",
        path: ["counts"],
        message: "Coverage counts do not reconcile.",
      });
    for (const [index, item] of value.items.entries()) {
      if (
        item.eligible !== (item.state === "eligible_unreserved") ||
        (item.eligible &&
          (item.reasonCode !== "eligible" || !item.packageId)) ||
        (item.state === "covered" &&
          (item.reasonCode !== "already_reserved" || !item.packageId))
      )
        context.addIssue({
          code: "custom",
          path: ["items", index],
          message: "Coverage state is inconsistent.",
        });
    }
  });

export type CreditCoverage = z.infer<typeof creditCoverageSchema>;
export type CreditCoverageReason = z.infer<typeof creditCoverageReasonSchema>;
export type LessonCreditCoverage = CreditCoverage["items"][number];

export const creditApplicationResultSchema = z
  .object({
    applied: z.number().int().nonnegative(),
    alreadyCovered: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipReasons: z.partialRecord(
      creditCoverageReasonSchema,
      z.number().int().nonnegative(),
    ),
    failureCodes: z.record(z.string(), z.number().int().nonnegative()),
    autoApplyPending: z.boolean(),
  })
  .superRefine((value, context) => {
    if (
      Object.values(value.skipReasons).reduce(
        (sum, count) => sum + count,
        0,
      ) !== value.skipped ||
      Object.values(value.failureCodes).reduce(
        (sum, count) => sum + count,
        0,
      ) !== value.failed ||
      value.autoApplyPending !== value.failed > 0
    )
      context.addIssue({
        code: "custom",
        message: "Credit application counts do not reconcile.",
      });
  });
export type CreditApplicationResult = z.infer<
  typeof creditApplicationResultSchema
>;
