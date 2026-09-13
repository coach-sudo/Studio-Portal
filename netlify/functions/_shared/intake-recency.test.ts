import { describe, expect, it } from "vitest";
import { pastOccurrence, staleReviewPayload } from "../../../src/domain/intakeRecency";

const now = Date.parse("2030-09-13T12:00:00Z");

describe("provider intake recency", () => {
  it("ignores past appointments even when the email arrived recently", () => {
    expect(staleReviewPayload({ candidate: { startsAt: "2030-03-01T15:00:00Z" }, headers: { date: "Sun, 13 Sep 2030 10:00:00 GMT" } }, now)).toBe(true);
    expect(staleReviewPayload({ candidate: { startsAt: "2030-09-20T15:00:00Z" }, headers: { date: "Sun, 01 Mar 2030 10:00:00 GMT" } }, now)).toBe(false);
  });

  it("clears stale calendar reviews and old unparsed email reviews", () => {
    expect(staleReviewPayload({ start: { dateTime: "2030-03-01T15:00:00Z" }, end: { dateTime: "2030-03-01T16:00:00Z" } }, now)).toBe(true);
    expect(staleReviewPayload({ headers: { date: "Sun, 01 Mar 2030 10:00:00 GMT" } }, now)).toBe(true);
    expect(staleReviewPayload({ headers: { date: "Thu, 01 Aug 2030 10:00:00 GMT" } }, now)).toBe(true);
    expect(pastOccurrence("2030-09-13T11:00:00Z", "2030-09-13T13:00:00Z", now)).toBe(false);
  });
});
