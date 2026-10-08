import { describe, expect, it } from "vitest";
import { calculatePackagePrice, packageOffer } from "./packagePricing";
import { demoSnapshot } from "../data/demo";

describe("calculatePackagePrice", () => {
  it("derives fixed and percentage package prices without accepting a final price", () => {
    expect(
      calculatePackagePrice({
        unitPriceMinor: 10_000,
        sessionCount: 4,
        discountType: "percent",
        discountBasisPoints: 1000,
      }),
    ).toEqual({
      basePriceMinor: 40_000,
      discountMinor: 4_000,
      priceMinor: 36_000,
    });
    expect(
      calculatePackagePrice({
        unitPriceMinor: 10_000,
        sessionCount: 4,
        discountType: "fixed",
        discountMinor: 5_000,
      }),
    ).toEqual({
      basePriceMinor: 40_000,
      discountMinor: 5_000,
      priceMinor: 35_000,
    });
  });

  it("never produces negative prices", () => {
    expect(
      calculatePackagePrice({
        unitPriceMinor: 5_000,
        sessionCount: 1,
        discountType: "fixed",
        discountMinor: 9_000,
      }).priceMinor,
    ).toBe(0);
  });
});

describe("current package offers", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  function fixture() {
    const data = structuredClone(demoSnapshot);
    const definition = data.packageDefinitions[0];
    definition.discountType = "percent";
    definition.discountBasisPoints = 1000;
    const service = data.bookingServices.find(
      (item) => item.id === definition.pricingServiceId,
    )!;
    service.priceMinor = 12000;
    service.version++;
    const student = data.students[0];
    student.specialPricingEnabled = true;
    data.studentPricingRules = [
      {
        id: "special",
        studioId: definition.studioId,
        studentId: student.id,
        serviceId: service.id,
        active: true,
        startsAt: "2026-10-01T00:00:00Z",
        endsAt: "2026-10-31T00:00:00Z",
        priceMinor: 8000,
        reason: "Special rate",
        version: 1,
        updatedAt: "2026-10-01T00:00:00Z",
      },
    ];
    return { data, definition, service, student };
  }
  it("refreshes public offers after a source rate change without altering any stored purchase", () => {
    const { data, definition } = fixture();
    const original = structuredClone(data);
    expect(packageOffer(definition, data, undefined, now)?.priceMinor).toBe(
      43200,
    );
    expect(data).toEqual(original);
  });
  it("discounts the enabled student's effective service rate", () => {
    const { data, definition, student } = fixture();
    expect(packageOffer(definition, data, student, now)?.priceMinor).toBe(
      28800,
    );
  });
  it.each([
    "disabled",
    "inactive",
    "future",
    "expired",
    "other student",
    "other studio",
    "other service",
  ])("ignores a %s special rate", (state) => {
    const { data, definition, student } = fixture();
    const rule = data.studentPricingRules[0];
    if (state === "disabled") student.specialPricingEnabled = false;
    if (state === "inactive") rule.active = false;
    if (state === "future") rule.startsAt = "2027-01-01T00:00:00Z";
    if (state === "expired") rule.endsAt = "2026-10-01T00:00:00Z";
    if (state === "other student") rule.studentId = "other";
    if (state === "other studio") rule.studioId = "other";
    if (state === "other service") rule.serviceId = "other";
    expect(packageOffer(definition, data, student, now)?.priceMinor).toBe(
      43200,
    );
  });
  it("uses location adjustments before discounts and preserves legacy standalone prices", () => {
    const { data, definition, student } = fixture();
    definition.deliveryFormat = "in_person";
    data.studentPricingRules[0].locationPriceAdjustments = { in_person: 500 };
    expect(packageOffer(definition, data, student, now)?.priceMinor).toBe(
      30600,
    );
    definition.pricingServiceId = undefined;
    expect(packageOffer(definition, data, student, now)).toBe(definition);
  });
  it("does not advertise a stale linked price when the source service is unavailable", () => {
    const { data, definition } = fixture();
    data.bookingServices = [];
    expect(packageOffer(definition, data, undefined, now)).toBeUndefined();
  });
});
