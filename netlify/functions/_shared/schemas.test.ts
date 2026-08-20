import { describe, expect, it } from "vitest";
import { commandSchema, publicBookingSchema } from "./schemas";

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

  it("requires the current terms version and affirmative acceptance", () => {
    expect(
      publicBookingSchema.parse({
        ...booking,
        termsAccepted: true,
        termsVersion: "2026-08-20",
      }).termsAccepted,
    ).toBe(true);
    expect(() => publicBookingSchema.parse(booking)).toThrow();
  });
});
