import { describe, expect, it } from "vitest";
import { lessonBulkPreviewRequest } from "../domain/lessonBulk";

describe("oversized request collections", () => {
  it("rejects an oversized lesson selection before reading or validating its elements", () => {
    let elementReads = 0;
    const selectedIds = new Array<string>(5001);
    Object.defineProperty(selectedIds, 0, {
      get() {
        elementReads++;
        return "invalid-private-input";
      },
    });
    const result = lessonBulkPreviewRequest.safeParse({
      operation: "archive",
      selectedIds,
    });
    expect(result.success).toBe(false);
    expect(elementReads).toBe(0);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ code: "too_big", path: ["selectedIds"] }),
      ]);
    }
  });

  it("retains per-element validation and accepts legitimate selections within the cap", () => {
    const valid = "11111111-1111-4111-8111-111111111111";
    expect(
      lessonBulkPreviewRequest.safeParse({
        operation: "archive",
        selectedIds: [valid],
      }).success,
    ).toBe(true);
    const invalid = lessonBulkPreviewRequest.safeParse({
      operation: "archive",
      selectedIds: ["invalid"],
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success)
      expect(invalid.error.issues[0].path).toEqual(["selectedIds", 0]);
  });
});
