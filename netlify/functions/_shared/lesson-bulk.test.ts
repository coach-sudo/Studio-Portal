// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { processLessonBulkItems } from "./lesson-bulk";
import type { serviceClient } from "./supabase";
import { lessonBulkPreviewRequest } from "../../../src/domain/lessonBulk";
import { toAppError } from "./http";

describe("bounded bulk worker and contract", () => {
  it("isolates an uncertain transport failure and continues the remaining claimed item", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          { id: "first", claim_token: "one" },
          { id: "second", claim_token: "two" },
        ],
        error: null,
      })
      .mockRejectedValueOnce(new Error("Reply lost after commit"))
      .mockResolvedValueOnce({ data: { status: "succeeded" }, error: null });
    const result = await processLessonBulkItems({
      rpc,
    } as unknown as ReturnType<typeof serviceClient>);
    expect(result).toEqual([
      { itemId: "first", status: "transport_pending" },
      { itemId: "second", status: "succeeded" },
    ]);
    expect(rpc).toHaveBeenCalledTimes(3);
  });
  it("rejects oversized explicit selections and student-scoped whole classes", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    expect(
      lessonBulkPreviewRequest.safeParse({
        operation: "delete",
        selectedIds: Array(5001).fill(id),
      }).success,
    ).toBe(false);
    expect(
      lessonBulkPreviewRequest.safeParse({
        operation: "cancel",
        selectedIds: [id],
        wholeClass: true,
        filter: { studentId: id },
      }).success,
    ).toBe(false);
  });
  it("reports expired and oversized reviews with safe actionable errors", () => {
    expect(toAppError(new Error("REVIEW_EXPIRED"))).toMatchObject({
      code: "REVIEW_REQUIRED",
      status: 409,
    });
    expect(toAppError(new Error("BATCH_TOO_LARGE"))).toMatchObject({
      code: "VALIDATION_FAILED",
      status: 422,
    });
  });
});
