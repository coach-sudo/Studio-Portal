import { describe, expect, it } from "vitest";
import { seriesDates } from "./booking";
import {
  continuationStart,
  selectRecurringOccurrences,
} from "./recurringOccurrences";
import type { Lesson, RecurringSeries } from "./model";

const timezone = "America/New_York";
const monday = "2031-02-03T21:00:00.000Z";
const series = {
  kind: "fixed",
  status: "active",
  cadence: "weekly",
  recurrenceRule: { intervalWeeks: 1, slots: [{ weekday: 1, time: "16:00" }] },
} satisfies Pick<
  RecurringSeries,
  "kind" | "status" | "cadence" | "recurrenceRule"
>;
const scheduled = (
  startsAt: string,
): Pick<Lesson, "startsAt" | "endsAt" | "status"> => ({
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
  status: "scheduled",
});

describe("booking continuity", () => {
  it("continues after the sixth recorded occurrence while preserving studio wall time across DST", () => {
    const existing = seriesDates(monday, "weekly", 6, timezone);
    expect(
      continuationStart(
        series,
        existing.map(scheduled),
        timezone,
        60,
        Date.parse("2031-01-01T12:00:00Z"),
      ),
    ).toBe("2031-03-17T20:00:00.000Z");
  });

  it("skips either the first or later proposed dates without moving the rest", () => {
    const proposed = seriesDates(monday, "weekly", 6, timezone);
    expect(
      selectRecurringOccurrences(proposed, [proposed[0], proposed[3]]),
    ).toEqual([proposed[1], proposed[2], proposed[4], proposed[5]]);
  });

  it("rejects duplicates, dates outside this proposal, and an empty selection", () => {
    const proposed = seriesDates(monday, "weekly", 6, timezone);
    expect(() =>
      selectRecurringOccurrences(proposed, ["2030-12-10T21:00:00Z"]),
    ).toThrow("outside this booking proposal");
    expect(() =>
      selectRecurringOccurrences(proposed, [proposed[1], proposed[1]]),
    ).toThrow("outside this booking proposal");
    expect(() => selectRecurringOccurrences(proposed, proposed)).toThrow(
      "at least one",
    );
  });

  it("surfaces a terminal exception or a changed slot before proposing an extension", () => {
    const first = scheduled(monday);
    const second = scheduled("2031-02-10T21:00:00.000Z");
    const now = Date.parse("2031-01-01T12:00:00Z");
    expect(
      continuationStart(
        series,
        [first, { ...second, status: "cancelled" }],
        timezone,
        60,
        now,
      ),
    ).toBeUndefined();
    expect(
      continuationStart(
        series,
        [first, scheduled("2031-02-10T22:00:00.000Z")],
        timezone,
        60,
        now,
      ),
    ).toBeUndefined();
    expect(
      continuationStart(
        { ...series, endsOn: "2031-02-17" },
        [first, second],
        timezone,
        60,
        now,
      ),
    ).toBeUndefined();
  });

  it("requires a verified recurrence rule, upcoming anchor and matching duration", () => {
    const first = scheduled(monday);
    const now = Date.parse("2031-01-01T12:00:00Z");
    expect(
      continuationStart(
        { ...series, recurrenceRule: { intervalWeeks: 1, slots: [] } },
        [first],
        timezone,
        60,
        now,
      ),
    ).toBeUndefined();
    expect(
      continuationStart(series, [first], timezone, 30, now),
    ).toBeUndefined();
    expect(
      continuationStart(
        series,
        [first],
        timezone,
        60,
        Date.parse("2031-03-01T12:00:00Z"),
      ),
    ).toBeUndefined();
  });
});
