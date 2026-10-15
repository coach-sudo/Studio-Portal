import { describe, expect, it } from "vitest";
import {
  creditApplicationMessage,
  creditCoverageReasons,
} from "./creditCoveragePresentation";
import {
  creditApplicationResultSchema,
  creditCoverageReasonSchema,
} from "./creditCoverage";

describe("credit outcome language", () => {
  it("does not claim new coverage for an already covered or failed lesson", () => {
    const result = creditApplicationResultSchema.parse({
      applied: 0,
      alreadyCovered: 4,
      skipped: 2,
      failed: 1,
      skipReasons: { partially_paid: 1, payment_pending: 1 },
      failureCodes: { P0001: 1 },
      autoApplyPending: true,
    });
    expect(creditApplicationMessage(result)).toBe(
      "0 newly covered · 4 already covered · 2 skipped · 1 failed. Coverage recovery is pending.",
    );
  });
  it("has a plain-language explanation for every authoritative reason", () => {
    expect(Object.keys(creditCoverageReasons).sort()).toEqual(
      [...creditCoverageReasonSchema.options].sort(),
    );
    expect(creditCoverageReasons.already_reserved).toBe("Credit reserved");
    expect(creditCoverageReasons.payment_pending).toContain("pending");
  });
});
