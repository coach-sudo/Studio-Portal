import { describe, expect, it } from "vitest";
import { commandSchema, parseCommand, publicBookingSchema } from "./schemas";

describe("command schema", () => {
  it("accepts version zero for create commands", () => {
    expect(
      commandSchema.parse({
        command: "create",
        idempotencyKey: "create-12345678",
        expectedVersion: 0,
        reason: "Create a production record",
        payload: {},
      }).expectedVersion,
    ).toBe(0);
  });

  it("still rejects negative record versions", () => {
    expect(() =>
      commandSchema.parse({
        command: "create",
        idempotencyKey: "create-12345678",
        expectedVersion: -1,
        reason: "Invalid version",
        payload: {},
      }),
    ).toThrow();
  });
});

describe("public booking terms", () => {
  const booking = {
    serviceId: "service",
    startsAt: "2026-09-01T15:00:00.000Z",
    endsAt: "2026-09-01T16:00:00.000Z",
    location: "google_meet",
    recurrence: "none",
    paymentPolicy: "pay_now",
    guestName: "Taylor Reed",
    guestEmail: "taylor@example.com",
    forMinor: false,
    timezone: "America/New_York",
  } as const;

  it("blocks new installments while preserving the other public payment policies", () => {
    const recurring = {
      ...booking,
      recurrence: "weekly",
      occurrenceCount: 2,
      termsAccepted: true,
      termsVersion: "2026-08-20",
    };
    const disabled = publicBookingSchema.safeParse({
      ...recurring,
      paymentPolicy: "installments",
    });
    expect(disabled.success).toBe(false);
    if (!disabled.success)
      expect(disabled.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["paymentPolicy"],
          message: expect.stringContaining(
            "Installment bookings are unavailable",
          ),
        }),
      );
    for (const paymentPolicy of [
      "pay_now",
      "pay_later",
      "deposit",
      "credits",
      "subscription",
    ])
      expect(
        publicBookingSchema.parse({ ...recurring, paymentPolicy })
          .paymentPolicy,
      ).toBe(paymentPolicy);
  });

  it("requires the current terms version and affirmative acceptance", () => {
    const parsed = publicBookingSchema.parse({
      ...booking,
      termsAccepted: true,
      termsVersion: "2026-08-20",
    });
    expect(parsed.termsAccepted).toBe(true);
    expect(parsed.createPortalProfile).toBe(false);
    expect(() => publicBookingSchema.parse(booking)).toThrow();
  });

  it("records an explicit optional portal-profile request", () => {
    expect(
      publicBookingSchema.parse({
        ...booking,
        createPortalProfile: true,
        termsAccepted: true,
        termsVersion: "2026-08-20",
      }).createPortalProfile,
    ).toBe(true);
  });
});

describe("domain command payload schemas", () => {
  const envelope = {
    command: "create",
    idempotencyKey: "idempotency-key",
    expectedVersion: 0,
    reason: "Create a lesson",
  };

  it("validates scheduling payloads before command dispatch", () => {
    expect(() =>
      parseCommand("lessons", {
        ...envelope,
        payload: {
          studentId: "11111111-1111-4111-8111-111111111111",
          startsAt: "2026-09-21T18:00:00.000Z",
          endsAt: "2026-09-21T17:00:00.000Z",
        },
      }),
    ).toThrow();
  });

  it("retains compatibility for commands without a specialized payload schema", () => {
    expect(
      parseCommand("settings", {
        ...envelope,
        command: "update",
        payload: { timezone: "America/New_York" },
      }).payload,
    ).toEqual({ timezone: "America/New_York" });
  });
});
