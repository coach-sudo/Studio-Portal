import { describe, expect, it } from "vitest";
import { derivePackageValues } from "./package-pricing";

describe("server-derived package pricing", () => {
  it("uses the published booking-service schema and never queries a removed active column", async () => {
    const filters: Array<[string, unknown]> = [];
    const rows: Record<string, unknown> = {
      booking_services: {
        id: "service-1",
        name: "Coaching",
        duration_minutes: 60,
        price_minor: 10000,
        currency: "USD",
        version: 3,
        published: true,
      },
      studios: { settings: { bookingDefaults: { inPersonUpchargeMinor: 2500 } } },
    };
    const db = {
      from(table: string) {
        const chain = {
          select() { return chain; },
          eq(column: string, value: unknown) { filters.push([column, value]); return chain; },
          async single() { return { data: rows[table], error: null }; },
        };
        return chain;
      },
    };
    const result = await derivePackageValues(db as never, "studio-1", {
      pricingServiceId: "service-1",
      sessionCount: 4,
      deliveryFormat: "in_person",
      discountType: "percent",
      discountBasisPoints: 1000,
    });
    expect(filters).not.toContainEqual(["active", true]);
    expect(result.values.base_price_minor).toBe(50000);
    expect(result.values.discount_minor).toBe(5000);
    expect(result.values.price_minor).toBe(45000);
  });
});
