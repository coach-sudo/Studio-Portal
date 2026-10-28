import { z } from "zod";
export const correctionPreviewSchema = z.object({
  lessonId: z.string().uuid(),
  version: z.number().int(),
  eligible: z.boolean(),
  reasonCode: z.string().nullable(),
  reviewToken: z.string(),
  financialReviewRequired: z.boolean(),
  providerReviewRequired: z.boolean(),
  completedInFuture: z.boolean(),
  bookingCount: z.number().int(),
  invoiceCount: z.number().int(),
  creditEntryCount: z.number().int(),
  participantCount: z.number().int(),
  sharedBooking: z.boolean(),
  status: z.string(),
});
export type CorrectionPreview = z.infer<typeof correctionPreviewSchema>;
export const correctionHistorySchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      recordedAt: z.string(),
      original: z.object({
        startsAt: z.string(),
        endsAt: z.string(),
        status: z.string(),
      }),
      corrected: z.object({
        startsAt: z.string(),
        endsAt: z.string(),
        status: z.string(),
      }),
      reason: z.string(),
      timezone: z.string(),
      financialReviewRequired: z.boolean(),
      providerReviewRequired: z.boolean(),
    }),
  ),
  hasMore: z.boolean(),
  nextCursor: z
    .object({ createdAt: z.string(), id: z.string().uuid() })
    .nullable(),
  lessonVersion: z.number().int(),
  total: z.number().int(),
  financialReviewsPending: z.number().int(),
  providerReviewsPending: z.number().int(),
});
export type CorrectionHistory = z.infer<typeof correctionHistorySchema>;
export const correctionReasons: Record<string, string> = {
  checkout_in_progress:
    "A payment checkout is in progress. Resolve it before correcting this date.",
  local_overlap:
    "This time overlaps another private lesson. Choose a different time.",
  booking_datetime_reconciliation:
    "The linked booking and lesson dates need reconciliation before correction.",
  linked_record_ownership_review:
    "A linked record requires an ownership review before correction.",
};
