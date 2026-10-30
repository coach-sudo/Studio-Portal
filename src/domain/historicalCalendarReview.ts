import { z } from "zod";
const common = {
  studentId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  acknowledgeSourceDifference: z.boolean().optional(),
  acknowledgeDuplicateReview: z.boolean().optional(),
};
export const historicalProposalSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      action: z.literal("link"),
      lessonId: z.string().uuid(),
      lessonVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("create"),
      startsAt: z.string().datetime({ offset: true }),
      endsAt: z.string().datetime({ offset: true }),
      timezone: z
        .string()
        .min(1)
        .max(100)
        .refine((value) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: value });
            return true;
          } catch {
            return false;
          }
        }, "Choose an explicit valid timezone."),
      topic: z.string().trim().min(1).max(300),
      locationType: z.enum(["in_person", "virtual"]),
      locationLabel: z.string().trim().min(1).max(500),
    })
    .strict()
    .refine(
      (value) => Date.parse(value.endsAt) > Date.parse(value.startsAt),
      "Choose an increasing interval.",
    ),
]);
export type HistoricalProposal = z.infer<typeof historicalProposalSchema>;
const stamp = z.string().regex(/^[0-9a-f]{64}$/);
const lesson = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  topic: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.string(),
});
export const historicalSourceSchema = z.object({
  candidateId: z.string().uuid(),
  studioId: z.string().uuid(),
  calendarId: z.string(),
  eventId: z.string(),
  summary: z.string(),
  sourceStatus: z.enum(["active", "cancelled"]),
  reasonCode: z.string(),
  stamp,
  observation: z.object({
    startsAt: z.string().nullable(),
    endsAt: z.string().nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
  }),
  decision: z
    .object({
      id: z.string().uuid(),
      version: z.number().int(),
      disposition: z.string(),
      lesson_id: z.string().uuid().nullable(),
      reason: z.string(),
    })
    .nullable(),
  priorSignals: z.array(
    z.object({
      id: z.string().uuid(),
      status: z.string(),
      lessonId: z.string().uuid().nullable(),
      updatedAt: z.string(),
      matchType: z.enum(["scoped", "legacy_unscoped"]),
    }),
  ),
  linkedLessons: z.array(lesson),
  attendanceVerified: z.literal(false),
  financialCoverageVerified: z.literal(false),
  canonicalEffects: z.array(z.never()).length(0),
});
export type HistoricalSource = z.infer<typeof historicalSourceSchema>;
export const historicalPreviewSchema = historicalSourceSchema.extend({
  phase: z.literal("preview"),
  proposal: historicalProposalSchema,
  student: z.object({
    id: z.string().uuid(),
    name: z.string(),
    version: z.number().int(),
  }),
  target: lesson.nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  sourceDifference: z.boolean(),
  sourceMatchCount: z.number().int(),
  intervalMatchCount: z.number().int(),
  sourceMatchExamples: z.array(
    z.object({ id: z.string().uuid(), topic: z.string() }),
  ),
  intervalMatchExamples: z.array(
    z.object({ id: z.string().uuid(), topic: z.string() }),
  ),
  examplesAreComplete: z.boolean(),
  blockedReason: z.string().nullable(),
  recordedOutcome: z.string(),
  proposedCanonicalEffects: z.array(
    z.enum(["historical_lesson", "confirmed_participant"]),
  ),
});
export type HistoricalPreview = z.infer<typeof historicalPreviewSchema>;
export interface HistoricalDecision {
  candidateId: string;
  stamp: string;
  action: "reopen" | "not_lesson" | "skip";
  reason: string;
  legacyImportId?: string;
  legacyUpdatedAt?: string;
  acknowledgeUnscoped?: boolean;
}
export const historicalReceiptSchema = z.object({
  resource: z.object({
    candidateId: z.string().uuid(),
    decisionId: z.string().uuid(),
    lessonId: z.string().uuid().nullable(),
    attendanceVerified: z.literal(false),
    financialCoverageVerified: z.literal(false),
    created: z.boolean().optional(),
    studentId: z.string().uuid().optional(),
    linked: z.boolean().optional(),
    recordedOutcome: z.string().optional(),
    disposition: z.string().optional(),
  }),
  auditEventId: z.string().uuid(),
  queuedSideEffects: z.array(z.never()).length(0),
});
export type HistoricalReceipt = z.infer<typeof historicalReceiptSchema>;
export const historicalLessonSchema = lesson;
export type HistoricalLesson = z.infer<typeof lesson>;
export const historicalHistorySchema = z
  .object({
    items: z.array(
      z.object({
        version: z.number().int(),
        action: z.string(),
        reason: z.string(),
        createdAt: z.string(),
      }),
    ),
    total: z.number().int(),
    hasMore: z.boolean(),
    nextBeforeVersion: z.number().int().nullable(),
  })
  .refine(
    (v) => !v.hasMore || v.nextBeforeVersion !== null,
    "History continuation is missing.",
  );
export type HistoricalHistory = z.infer<typeof historicalHistorySchema>;
export function historicalHold(reason: string) {
  const labels: Record<string, string> = {
    reopen_required:
      "Reopen the exact ignored signal or finalized decision before linking or recording a lesson.",
    source_identity_requires_review:
      "An existing source-linked lesson needs review. Open its original record instead of creating another.",
    existing_historical_interval:
      "A lesson already exists for this student and interval. Choose the existing record.",
    private_lesson_overlap:
      "This interval overlaps a private lesson. Correct the interval or review the existing lesson.",
    preserve_canonical_link:
      "Keep the original canonical lesson link. This action cannot move its history.",
    student_identity_requires_review:
      "The source belongs to another original student. Review identity separately; no ownership has moved.",
    ambiguous_legacy_calendar:
      "The legacy signal is ambiguous across calendars. Review the original source identity first.",
    source_difference_acknowledgement_required:
      "Confirm that you reviewed the difference between this source and the chosen lesson time.",
    duplicate_review_acknowledgement_required:
      "Review the matching lessons before confirming this exact link.",
  };
  return labels[reason] || "This source requires further review before saving.";
}
