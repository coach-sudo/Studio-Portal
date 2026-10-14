import { studioCommand } from "./bookingCommands";
import type {
  LessonBulkPreview,
  LessonBulkPreviewInput,
  LessonBulkProgress,
} from "../domain/lessonBulk";

// Caller retains each key across transport retries; preview keys and execution
// keys are separate. Selection changes require a new preview/key.
export async function previewLessonBulk(
  input: LessonBulkPreviewInput,
  reason: string,
  key: string,
): Promise<LessonBulkPreview> {
  return (
    await studioCommand("lessons", {
      command: "preview_bulk",
      payload: input,
      reason,
      expectedVersion: 0,
      idempotencyKey: key,
    })
  ).resource;
}
export async function executeLessonBulk(
  review: Pick<LessonBulkPreview, "jobId" | "reviewToken">,
  key: string,
) {
  return (
    await studioCommand("lessons", {
      command: "execute_bulk",
      payload: review,
      reason: "Execute reviewed lesson batch",
      expectedVersion: 0,
      idempotencyKey: key,
    })
  ).resource as { jobId: string; accepted: boolean; duplicate: boolean };
}
export async function readLessonBulkProgress(
  jobId: string,
  offset = 0,
  limit = 50,
): Promise<LessonBulkProgress> {
  return (
    await studioCommand("lessons", {
      command: "bulk_progress",
      payload: { jobId, offset, limit },
      reason: "Read reviewed lesson batch",
      expectedVersion: 0,
    })
  ).resource;
}
export async function retryLessonBulk(
  review: Pick<LessonBulkPreview, "jobId" | "reviewToken">,
  key: string,
) {
  return (
    await studioCommand("lessons", {
      command: "retry_bulk",
      payload: review,
      reason: "Retry failed reviewed items",
      expectedVersion: 0,
      idempotencyKey: key,
    })
  ).resource as { jobId: string; retried: number };
}
