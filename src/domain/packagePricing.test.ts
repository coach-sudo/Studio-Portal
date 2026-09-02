import { describe, expect, it } from "vitest";
import { calculatePackagePrice } from "./packagePricing";

describe("calculatePackagePrice", () => {
  it("derives fixed and percentage package prices without accepting a final price", () => {
    expect(calculatePackagePrice({ unitPriceMinor: 10_000, sessionCount: 4, discountType: "percent", discountBasisPoints: 1000 })).toEqual({ basePriceMinor: 40_000, discountMinor: 4_000, priceMinor: 36_000 });
    expect(calculatePackagePrice({ unitPriceMinor: 10_000, sessionCount: 4, discountType: "fixed", discountMinor: 5_000 })).toEqual({ basePriceMinor: 40_000, discountMinor: 5_000, priceMinor: 35_000 });
  });

  it("never produces negative prices", () => {
    expect(calculatePackagePrice({ unitPriceMinor: 5_000, sessionCount: 1, discountType: "fixed", discountMinor: 9_000 }).priceMinor).toBe(0);
  });
});
