import { describe, expect, it } from "vitest";
import {
  buildAvailability,
  cancelDemoBooking,
  isLateChange,
  remainingCapacity,
  seriesDates,
} from "./booking";
import { demoSnapshot } from "../data/demo";

const service = {
  ...demoSnapshot.bookingServices[0],
  minimumNoticeHours: 0,
  bufferBeforeMinutes: 15,
  bufferAfterMinutes: 15,
};
describe("booking rules", () => {
  it("removes lessons including service buffers", () => {
    const from = new Date("2030-01-08T05:00:00Z");
    const rules = [
      {
        ...demoSnapshot.availabilityRules[0],
        weekday: 2,
        timezone: "America/New_York",
        startsAtLocal: "09:00",
        endsAtLocal: "12:00",
      },
    ];
    const lessons = [
      {
        ...demoSnapshot.lessons[0],
        startsAt: "2030-01-08T15:00:00.000Z",
        endsAt: "2030-01-08T16:00:00.000Z",
      },
    ];
    const input = {
      service,
      rules,
      exceptions: [],
      lessons,
      from,
      days: 1,
      now: new Date("2029-01-01T00:00:00Z"),
    };
    expect(buildAvailability({ ...input, lessons: [] }).length).toBeGreaterThan(
      0,
    );
    const slots = buildAvailability(input).map((slot) => slot.startsAt);
    expect(slots).not.toContain("2030-01-08T15:00:00.000Z");
    expect(slots).not.toContain("2030-01-08T14:00:00.000Z");
  });
  it("removes blackout windows", () => {
    const from = new Date("2030-01-08T05:00:00Z");
    const rules = [
      {
        ...demoSnapshot.availabilityRules[0],
        weekday: 2,
        timezone: "America/New_York",
        startsAtLocal: "09:00",
        endsAtLocal: "12:00",
      },
    ];
    const exceptions = [
      {
        ...demoSnapshot.availabilityExceptions[0],
        startsAt: "2030-01-08T14:00:00.000Z",
        endsAt: "2030-01-08T17:00:00.000Z",
      },
    ];
    expect(
      buildAvailability({
        service,
        rules,
        exceptions,
        lessons: [],
        from,
        days: 1,
        now: new Date("2029-01-01T00:00:00Z"),
      }),
    ).toHaveLength(0);
  });
  it("calculates class capacity without going negative", () => {
    expect(remainingCapacity(8, 5, 2)).toBe(1);
    expect(remainingCapacity(8, 9)).toBe(0);
  });
  it("keeps weekly and biweekly series on their cadence", () => {
    const weekly = seriesDates("2030-01-08T15:00:00.000Z", "weekly", 3);
    const biweekly = seriesDates("2030-01-08T15:00:00.000Z", "biweekly", 3);
    expect(
      (new Date(weekly[1]).getTime() - new Date(weekly[0]).getTime()) /
        86400000,
    ).toBe(7);
    expect(
      (new Date(biweekly[1]).getTime() - new Date(biweekly[0]).getTime()) /
        86400000,
    ).toBe(14);
  });
  it("keeps recurring wall time through daylight-saving changes", () => {
    const dates = seriesDates(
      "2030-03-03T15:00:00.000Z",
      "weekly",
      3,
      "America/New_York",
    );
    const local = dates.map((value) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
      }).format(new Date(value)),
    );
    expect(local).toEqual(["10 AM", "10 AM", "10 AM"]);
    expect(
      (new Date(dates[1]).getTime() - new Date(dates[0]).getTime()) / 3600000,
    ).toBe(167);
  });
  it("applies the cancellation notice boundary", () => {
    expect(
      isLateChange(
        "2030-01-02T00:00:00.000Z",
        24,
        new Date("2030-01-01T01:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isLateChange(
        "2030-01-03T00:00:00.000Z",
        24,
        new Date("2030-01-01T01:00:00.000Z"),
      ),
    ).toBe(false);
  });
  it("releases a class seat without cancelling the shared occurrence", () => {
    const draft = structuredClone(demoSnapshot),
      booking = draft.bookings.find(
        (item) => item.offeringId,
      )! as (typeof draft.bookings)[number],
      offering = draft.serviceOfferings.find(
        (item) => item.id === booking.offeringId,
      )!,
      before = offering.enrolled;
    cancelDemoBooking(draft, booking, { late: false });
    expect(offering.enrolled).toBe(before - 1);
    expect(
      draft.lessons.find((item) => item.offeringId === offering.id)?.status,
    ).toBe("scheduled");
    expect(
      draft.lessonParticipants
        .filter((item) => item.bookingId === booking.id)
        .every((item) => item.status === "cancelled"),
    ).toBe(true);
  });
});
