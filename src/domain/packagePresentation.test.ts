import { describe, expect, it } from "vitest";
import { packageBenefitLines } from "./packagePresentation";

describe("packageBenefitLines", () => {
  it("keeps configured pricing authoritative and includes coach copy", () => {
    expect(
      packageBenefitLines({
        currency: "USD",
        discountType: "percent",
        discountBasisPoints: 1250,
        discountMinor: 0,
        expirationDays: 90,
        recurringEligible: true,
        benefitText: "Priority scheduling with your coach",
      }),
    ).toEqual([
      "12.5% package discount",
      "Use within 90 days",
      "Eligible for recurring scheduling",
      "Priority scheduling with your coach",
    ]);
  });

  it("does not imply savings when no advantage is configured", () => {
    expect(
      packageBenefitLines({
        currency: "USD",
        discountType: "none",
        discountBasisPoints: 0,
        discountMinor: 0,
        recurringEligible: false,
      }),
    ).toEqual(["Multi-session bundle"]);
  });
});
