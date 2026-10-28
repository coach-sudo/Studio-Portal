import { z } from "zod";
const hasContinuation = (value: { hasMore: boolean; nextCursor: unknown }) =>
  !value.hasMore || value.nextCursor !== null;
export const accessibleCalendarsSchema = z
  .object({
    items: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        timezone: z.string().nullable(),
        accessRole: z.string(),
        primary: z.boolean(),
        selectable: z.boolean(),
      }),
    ),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  })
  .refine(hasContinuation, {
    message:
      "The calendar list is missing its continuation. Refresh before assuming complete coverage.",
  });
export type AccessibleCalendar = z.infer<
  typeof accessibleCalendarsSchema
>["items"][number];
export interface DiscoveryRequest {
  from: string;
  to: string;
  timezone: string;
  calendars: Array<{ id: string; label: string; timezone: string | null }>;
}
export interface DiscoveryPageRequest {
  scanId: string;
  calendarId: string;
  pageSequence: number;
}
export const discoveryAcceptedSchema = z.object({
  scanId: z.string().uuid(),
  accepted: z.literal(true),
  statusAtAcceptance: z.literal("queued"),
});
export const discoveryCheckpointSchema = z.object({
  scanId: z.string().uuid(),
  calendarId: z.string(),
  pageSequence: z.number().int(),
  observed: z.number().int(),
  checkpointCommitted: z.literal(true),
});
export const discoveryProgressSchema = z
  .object({
    scanId: z.string().uuid(),
    from: z.string(),
    to: z.string(),
    timezone: z.string(),
    status: z.enum(["queued", "running", "partial", "failed", "completed"]),
    total: z.number().int(),
    hasMore: z.boolean(),
    nextCursor: z.string().uuid().nullable(),
    sources: z.array(
      z.object({
        calendarId: z.string(),
        label: z.string(),
        calendarTimezone: z.string().nullable(),
        status: z.enum([
          "queued",
          "running",
          "completed",
          "failed",
          "retry_required",
        ]),
        pageSequence: z.number().int(),
        observed: z.number().int(),
        attempts: z.number().int(),
        lastAttemptAt: z.string().nullable(),
        lastSuccessAt: z.string().nullable(),
        failureCode: z.string().nullable(),
      }),
    ),
    items: z.array(
      z.object({
        id: z.string().uuid(),
        calendarId: z.string(),
        eventId: z.string(),
        sourceKey: z.string(),
        summary: z.string(),
        sourceStatus: z.enum(["active", "cancelled"]),
        startsAt: z.string().nullable(),
        endsAt: z.string().nullable(),
        startDate: z.string().nullable(),
        endDate: z.string().nullable(),
        timezone: z.string().nullable(),
        recurringEventId: z.string().nullable(),
        originalStart: z.string().nullable(),
        reasonCode: z.string(),
        possibleLessonCount: z.number().int(),
        possiblePriorSignals: z.array(
          z.object({
            id: z.string().uuid(),
            status: z.string(),
            lessonId: z.string().uuid().nullable(),
            matchType: z.enum(["scoped", "legacy_unscoped"]),
          }),
        ),
      }),
    ),
  })
  .refine(hasContinuation, {
    message:
      "The preview is missing its candidate continuation. Refresh before assuming complete coverage.",
  });
export type DiscoveryProgress = z.infer<typeof discoveryProgressSchema>;
export type DiscoveryCandidate = DiscoveryProgress["items"][number];
export const savedDiscoveriesSchema = z
  .object({
    items: z.array(
      z.object({
        scanId: z.string().uuid(),
        from: z.string(),
        to: z.string(),
        timezone: z.string(),
        createdAt: z.string(),
        calendarCount: z.number().int(),
        candidateCount: z.number().int(),
      }),
    ),
    total: z.number().int(),
    hasMore: z.boolean(),
    nextCursor: z
      .object({ createdAt: z.string(), id: z.string().uuid() })
      .nullable(),
  })
  .refine(hasContinuation, {
    message:
      "Saved previews are missing their continuation. Refresh before assuming complete coverage.",
  });
export type SavedDiscoveries = z.infer<typeof savedDiscoveriesSchema>;
export const discoveryReasons: Record<string, string> = {
  event_detected:
    "Event detected; lesson identity and attendance are unverified.",
  date_only_requires_time:
    "All-day/date-only entry. A coach must confirm a time before it can become a lesson.",
  invalid_time_requires_review:
    "The source does not provide a valid lesson interval. Coach review is required.",
  cancelled_source_requires_review:
    "Cancelled/deleted source event. Existing lesson outcomes stay unchanged.",
};
export const discoveryFailures: Record<string, string> = {
  access_denied:
    "Read access was denied. Reconnect or select an accessible calendar, then retry this page.",
  rate_limited: "Google limited reads. Wait, then retry this saved page.",
  provider_unavailable:
    "Google could not finish this read. Retry the saved page; completed pages are retained.",
  invalid_payload:
    "The response was incomplete or invalid. Retry or review the connection.",
  invalid_pagination:
    "Google repeated a continuation. Keep this preview and start a fresh one for recovery.",
  checkpoint_unconfirmed:
    "The checkpoint response is unconfirmed. Refresh progress and recover the same page receipt.",
};
