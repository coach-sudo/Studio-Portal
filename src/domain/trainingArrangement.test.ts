import { describe, expect, it } from "vitest";
import type { Invoice } from "./invoices";
import type { Booking, Lesson, RecurringSeries } from "./model";
import {
  lessonPaymentState,
  trainingArrangement,
  trainingObligations,
} from "./trainingArrangement";

const lesson = (overrides: Partial<Lesson> = {}): Lesson => ({
  id: "lesson",
  studentId: "student",
  studioId: "studio",
  version: 1,
  topic: "Rehearsal",
  startsAt: "2031-04-07T20:00:00Z",
  endsAt: "2031-04-07T21:00:00Z",
  updatedAt: "",
  status: "scheduled",
  sourceProvider: "studio",
  locationType: "virtual",
  locationLabel: "Online",
  priceMinor: 8500,
  paidMinor: 0,
  paymentStatus: "due",
  invoiceId: "invoice",
  ...overrides,
});
const invoice = (
  lessons: string[],
  overrides: Partial<Invoice> = {},
): Invoice => ({
  id: "invoice",
  studio_id: "studio",
  student_id: "student",
  number: "A-1",
  currency: "USD",
  status: "open",
  issue_date: "2031-03-01",
  due_date: "2031-04-01",
  introduction: "",
  notes: "",
  footer: "",
  branding: { studioName: "Studio" },
  recipient: { name: "Student" },
  version: 1,
  created_at: "",
  paid_minor: 0,
  total_minor: lessons.length * 8500,
  credit_minor: 0,
  items: lessons.map((id) => ({
    id: `line-${id}`,
    kind: "service",
    referenceId: "service",
    description: "Rehearsal",
    quantity: 1,
    unitMinor: 8500,
    startsOn: "2031-04-07",
    endsOn: "2031-04-07",
    lessonIds: [id],
    creditMinor: 0,
    paidMinor: 0,
  })),
  ...overrides,
});
const series: RecurringSeries = {
  id: "series",
  studioId: "studio",
  studentId: "student",
  kind: "fixed",
  cadence: "weekly",
  startsOn: "2031-04-07",
  status: "active",
  updatedAt: "",
  paymentPolicy: "pay_later",
  recurrenceRule: { intervalWeeks: 1, slots: [{ weekday: 1, time: "16:00" }] },
  studentCanModify: false,
  discountMinor: 0,
  version: 1,
};
const now = new Date("2031-04-05T16:00:00Z");
const data = {
  bookings: [],
  lessonParticipants: [],
  recurringSeries: [series],
};

describe("training arrangement", () => {
  it("counts six confirmed appointments and uses only recorded series relationships", () => {
    const entries = Array.from({ length: 6 }, (_, i) =>
      lesson({
        id: `lesson-${i}`,
        seriesId: i === 5 ? undefined : "series",
        startsAt: new Date(
          Date.parse("2031-04-07T20:00:00Z") + i * 7 * 86400000,
        ).toISOString(),
        endsAt: new Date(
          Date.parse("2031-04-07T21:00:00Z") + i * 7 * 86400000,
        ).toISOString(),
      }),
    );
    const result = trainingArrangement(
      {
        ...data,
        lessons: [
          ...entries,
          lesson({ id: "cancelled", status: "cancelled" }),
          lesson({ id: "draft", status: "draft" }),
          lesson({ id: "unrelated", studentId: "other" }),
        ],
      },
      "student",
      now,
    );
    expect(result.coachScheduledCount).toBe(6);
    expect(
      result.upcoming.slice(0, 5).every((item) => item.series?.id === "series"),
    ).toBe(true);
    expect(result.upcoming[5].series).toBeUndefined();
    expect(result.history.map((item) => item.lesson.id)).toEqual([
      "draft",
      "cancelled",
    ]);
  });

  it("distinguishes coverage, pending, missing pricing and reversals", () => {
    expect(
      lessonPaymentState(lesson({ paymentStatus: "paid_by_credit" })),
    ).toBe("paid");
    expect(lessonPaymentState(lesson({ invoicePaymentPending: true }))).toBe(
      "processing",
    );
    expect(lessonPaymentState(lesson({ paymentStatus: "untracked" }))).toBe(
      "review",
    );
    expect(lessonPaymentState(lesson({ paymentStatus: "refunded" }))).toBe(
      "review",
    );
    expect(lessonPaymentState(lesson({ status: "cancelled" }))).toBe(
      "cancelled",
    );
  });

  it("does not use another attendee's paid lesson as the student's coverage", () => {
    const entry = lesson({
      studentId: "other",
      paymentStatus: "paid_by_credit",
    });
    const booking = {
      id: "booking",
      studentId: "student",
      status: "confirmed",
      paymentStatus: "due",
    } as Booking;
    const result = trainingArrangement(
      {
        ...data,
        lessons: [entry],
        bookings: [booking],
        lessonParticipants: [
          {
            id: "part",
            bookingId: "booking",
            lessonId: entry.id,
            studentId: "student",
            status: "confirmed",
            displayName: "",
            email: "",
          },
        ],
      },
      "student",
      now,
    );
    expect(result.upcoming[0].payment).toBe("unpaid");
  });

  it("marks a missing series record for review", () => {
    const result = trainingArrangement(
      { ...data, lessons: [lesson({ seriesId: "missing" })] },
      "student",
      now,
    );
    expect(result.upcoming[0].seriesNeedsReview).toBe(true);
  });
});

describe("full lesson obligations", () => {
  it("itemizes only the unpaid remainder of a lesson after existing adjustments", () => {
    const record = invoice(["lesson", "other"]);
    record.credit_minor = 2000;
    record.paid_minor = 1000;
    record.items[0].creditMinor = 2000;
    record.items[0].paidMinor = 1000;
    expect(
      trainingObligations([record], "student").map((item) => [
        item.lessonId,
        item.amountMinor,
      ]),
    ).toEqual([
      ["lesson", 5500],
      ["other", 8500],
    ]);
  });

  it("does not offer a duplicate, canceled or already covered obligation", () => {
    const arrangement = trainingArrangement(
      {
        ...data,
        lessons: [
          lesson({ id: "covered", paymentStatus: "paid_by_credit" }),
          lesson({ id: "cancelled", status: "cancelled" }),
          lesson({ id: "duplicate" }),
        ],
      },
      "student",
      now,
    );
    const records = [
      invoice(["covered", "cancelled", "duplicate"]),
      invoice(["duplicate"], { id: "second" }),
      invoice(["another-student"], { id: "unauthorized", student_id: "other" }),
    ];
    const obligations = trainingObligations(records, "student", arrangement);
    expect(obligations).toHaveLength(4);
    expect(obligations.every((item) => !item.eligible)).toBe(true);
  });

  it("blocks a pending invoice and inconsistent totals", () => {
    const pending = trainingObligations(
      [invoice(["lesson"], { checkout_key: "training:attempt" })],
      "student",
    )[0];
    const mismatch = trainingObligations(
      [invoice(["lesson"], { total_minor: 7000 })],
      "student",
    )[0];
    expect(pending).toMatchObject({ eligible: false, pending: true });
    expect(mismatch).toMatchObject({ eligible: false, pending: false });
  });
});
