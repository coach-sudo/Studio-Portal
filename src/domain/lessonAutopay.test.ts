import { describe, expect, it } from "vitest";
import {
  previewLessonAutopay,
  type AutopayOccurrence,
  type AutopayPolicy,
  type AutopaySelection,
} from "./lessonAutopay";

const policy: AutopayPolicy = {
  timeZone: "America/New_York",
  chargeAtLocal: "09:00",
  minimumLeadDays: 0,
  maximumLeadDays: 7,
};
const selection: AutopaySelection = {
  scope: "existing_and_future",
  leadDays: 2,
  existingLessonIds: ["one", "two", "three"],
  effectiveAt: "2031-02-01T12:00:00Z",
  currency: "USD",
  maximumLessonMinor: 8500,
};
const occurrence = (
  id: string,
  startsAt: string,
  overrides: Partial<AutopayOccurrence> = {},
): AutopayOccurrence => ({
  id,
  startsAt,
  createdAt: "2031-02-13T12:00:00Z",
  status: "scheduled",
  payment: "unpaid",
  obligation: {
    lessonId: id,
    studentId: "student",
    invoiceId: "invoice",
    invoiceVersion: 1,
    invoiceNumber: "INV-1",
    lineId: id,
    description: "Coaching",
    date: startsAt.slice(0, 10),
    amountMinor: 8500,
    adjustmentsMinor: 0,
    currency: "USD",
    pending: false,
    eligible: true,
  },
  ...overrides,
});
const current = (date: string) => new Date(date);

describe("automatic payment proposal", () => {
  it("uses local calendar days and keeps the same hour across the DST transition", () => {
    const rows = [
      occurrence("one", "2031-03-08T20:00:00Z"),
      occurrence("two", "2031-03-12T20:00:00Z"),
    ];
    expect(
      previewLessonAutopay(
        policy,
        selection,
        rows,
        current("2031-03-01T00:00:00Z"),
      ),
    ).toMatchObject([
      { lessonId: "one", payAt: "2031-03-06T14:00:00.000Z" },
      { lessonId: "two", payAt: "2031-03-10T13:00:00.000Z" },
    ]);
  });

  it("future-only scope excludes prior, cancelled and prepaid lessons", () => {
    const rows = [
      occurrence("one", "2031-03-18T20:00:00Z", {
        createdAt: "2031-01-20T11:00:00Z",
      }),
      occurrence("two", "2031-03-20T20:00:00Z", { payment: "paid" }),
      occurrence("three", "2031-03-21T20:00:00Z", { status: "cancelled" }),
      occurrence("new", "2031-03-22T20:00:00Z"),
    ];
    expect(
      previewLessonAutopay(
        policy,
        { ...selection, scope: "future" },
        rows,
        current("2031-03-01T00:00:00Z"),
      ),
    ).toMatchObject([{ lessonId: "new", state: "scheduled" }]);
  });

  it("existing-only enrollment follows the explicit lesson selection", () => {
    const rows = [
      occurrence("one", "2031-03-20T20:00:00Z"),
      occurrence("new", "2031-03-24T20:00:00Z"),
    ];
    expect(
      previewLessonAutopay(
        policy,
        { ...selection, scope: "existing" },
        rows,
        current("2031-03-01T00:00:00Z"),
      ),
    ).toMatchObject([{ lessonId: "one", state: "scheduled" }]);
  });

  it("offers deliberate Pay now when booked or moved inside the lead window", () => {
    const rows = [
      occurrence("one", "2031-03-20T20:00:00Z", {
        createdAt: "2031-03-19T12:00:00Z",
      }),
      occurrence("two", "2031-03-20T20:00:00Z", {
        approvedPaymentAt: "2031-03-21T13:00:00.000Z",
      }),
    ];
    expect(
      previewLessonAutopay(
        policy,
        selection,
        rows,
        current("2031-03-19T13:00:00Z"),
      ),
    ).toMatchObject([
      { lessonId: "one", state: "pay_now" },
      { lessonId: "two", state: "pay_now" },
    ]);
  });

  it("recognizes an unchanged previously scheduled attempt at its due time", () => {
    const rows = [
      occurrence("one", "2031-03-20T20:00:00Z", {
        approvedPaymentAt: "2031-03-18T13:00:00.000Z",
      }),
    ];
    expect(
      previewLessonAutopay(
        policy,
        selection,
        rows,
        current("2031-03-18T13:00:00Z"),
      ),
    ).toMatchObject([{ lessonId: "one", state: "ready" }]);
  });

  it("leaves a wider price or a missing obligation for review", () => {
    const row = occurrence("one", "2031-03-20T20:00:00Z");
    const changed = {
      ...row,
      obligation: { ...row.obligation!, amountMinor: 9000 },
    };
    expect(
      previewLessonAutopay(
        policy,
        selection,
        [changed, { ...row, id: "two", obligation: undefined }],
        current("2031-03-01T00:00:00Z"),
      ),
    ).toMatchObject([
      { lessonId: "one", state: "review" },
      { lessonId: "two", state: "review" },
    ]);
  });

  it("restricts lead-time options to the studio's configured range", () => {
    expect(() =>
      previewLessonAutopay(policy, { ...selection, leadDays: 8 }, []),
    ).toThrow("automatic payment limits");
  });
});
