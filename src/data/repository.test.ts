import { describe, expect, it, vi } from "vitest";
import { loadStudioSnapshot, resolveAccountDisplayName } from "./repository";
import { packageOffer } from "../domain/packagePricing";

const database = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  isDemoMode: false,
  isSupabaseConfigured: true,
  supabase: database,
}));

it("retains student location adjustments from the RLS snapshot in package quotes", async () => {
  database.rpc.mockResolvedValue({
    error: null,
    data: {
      currentUserId: "user",
      membership: { studio_id: "studio", role: "student" },
      students: [
        { id: "student", studio_id: "studio", special_pricing_enabled: true },
      ],
      pricingRules: [
        {
          id: "rate",
          studio_id: "studio",
          student_id: "student",
          service_id: "service",
          price_minor: 8000,
          location_price_adjustments: { in_person: 500 },
          active: true,
          starts_at: "2020-01-01T00:00:00Z",
          updated_at: "2020-01-01T00:00:00Z",
        },
      ],
      bookingServices: [
        {
          id: "service",
          studio_id: "studio",
          price_minor: 10000,
          currency: "USD",
          location_price_adjustments: { in_person: 100 },
        },
      ],
      packageDefinitions: [
        {
          id: "offer",
          studio_id: "studio",
          pricing_service_id: "service",
          session_count: 4,
          delivery_format: "in_person",
          discount_type: "none",
        },
      ],
    },
  });
  const snapshot = await loadStudioSnapshot(
    "student",
    "student",
    ["identity", "finance", "lessons"],
    undefined,
    false,
  );
  expect(snapshot.studentPricingRules[0].locationPriceAdjustments).toEqual({
    in_person: 500,
  });
  expect(
    packageOffer(snapshot.packageDefinitions[0], snapshot, snapshot.students[0])
      ?.priceMinor,
  ).toBe(34000);
});

describe("account display names", () => {
  it("uses the linked contact's saved name for guardian and support accounts", () => {
    expect(
      resolveAccountDisplayName(
        "guardian",
        "User",
        { full_name: "Student Name" },
        { full_name: "Dana Patterson" },
      ),
    ).toBe("Dana Patterson");
  });

  it("uses a student's preferred name ahead of generic account metadata", () => {
    expect(
      resolveAccountDisplayName("student", "User", {
        full_name: "Maya Kim",
        preferred_name: "Maya",
      }),
    ).toBe("Maya");
  });
});
