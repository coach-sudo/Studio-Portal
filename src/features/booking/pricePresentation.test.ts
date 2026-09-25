import { describe, expect, it } from "vitest";
import type { BookingService } from "../../domain/model";
import {
  exactBookingPriceLabel,
  serviceCatalogPriceLabel,
} from "./pricePresentation";

const service = (overrides: Partial<BookingService> = {}) =>
  ({
    id: "service",
    studioId: "studio",
    name: "Coaching",
    description: "Coaching",
    durationMinutes: 60,
    priceMinor: 0,
    currency: "USD",
    locationOptions: ["google_meet"],
    locationPriceAdjustments: {},
    active: true,
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }) as BookingService;

describe("booking price presentation", () => {
  it("calls an entirely free service Free", () => {
    expect(serviceCatalogPriceLabel(service())).toBe("Free");
    expect(exactBookingPriceLabel(0, "USD")).toBe("Free");
  });

  it("retains From when location options genuinely vary", () => {
    expect(
      serviceCatalogPriceLabel(
        service({
          priceMinor: 5000,
          locationOptions: ["google_meet", "in_person"],
          locationPriceAdjustments: { in_person: 2500 },
        }),
      ),
    ).toBe("From $50.00");
  });
});
