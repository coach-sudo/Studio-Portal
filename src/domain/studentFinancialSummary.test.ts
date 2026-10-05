import { describe, it, expect } from "vitest";
import { demoSnapshot } from "../data/demo";
import { studentFinancialSummary } from "./studentFinancialSummary";
import type { Booking } from "./model";
const now = Date.parse("2026-10-05T12:00:00Z");
function fixture() {
  const data = structuredClone(demoSnapshot),
    student = data.students[0];
  data.bookings = [];
  data.lessonParticipants = [];
  data.packages = [];
  data.creditEntries = [];
  data.lessons = [
    {
      ...data.lessons[0],
      studentId: student.id,
      paymentStatus: "due",
      priceMinor: 8500,
      paidMinor: 0,
      packageId: undefined,
      status: "scheduled",
      startsAt: "2026-10-06T12:00:00Z",
      endsAt: "2026-10-06T13:00:00Z",
    },
  ];
  return { data, student };
}
describe("student financial setup summary", () => {
  it("uses the recorded booking due date and never invents a payment deadline", () => {
    const { data, student } = fixture();
    expect(
      studentFinancialSummary(student, data, now).nextPaymentDueAt,
    ).toBeUndefined();
    const lesson = data.lessons[0];
    data.bookings = [
      {
        id: "booking",
        studentId: student.id,
        startsAt: lesson.startsAt,
        endsAt: lesson.endsAt,
        paymentStatus: "due",
        balanceDueAt: "2026-10-05T18:00:00Z",
      } as Booking,
    ];
    expect(studentFinancialSummary(student, data, now).nextPaymentDueAt).toBe(
      "2026-10-05T18:00:00Z",
    );
  });
  it("counts past due lessons as outstanding, not only future lessons", () => {
    const { data, student } = fixture();
    data.lessons[0].startsAt = "2026-10-01T12:00:00Z";
    data.lessons[0].endsAt = "2026-10-01T13:00:00Z";
    expect(studentFinancialSummary(student, data, now).outstandingMinor).toBe(
      8500,
    );
  });
  it("does not count one booking balance twice for recurring lessons", () => {
    const { data, student } = fixture(),
      lesson = data.lessons[0];
    data.lessons.push({
      ...lesson,
      id: "second",
      startsAt: "2026-10-13T12:00:00Z",
      endsAt: "2026-10-13T13:00:00Z",
    });
    data.bookings = [
      {
        id: "booking",
        studentId: student.id,
        status: "confirmed",
        paymentStatus: "due",
        paymentPolicy: "pay_later",
        totalMinor: 17000,
        paidMinor: 8500,
      } as Booking,
    ];
    data.lessonParticipants = data.lessons.map((item) => ({
      id: item.id,
      lessonId: item.id,
      bookingId: "booking",
      studentId: student.id,
      email: student.email!,
      displayName: student.fullName,
      status: "confirmed",
    }));
    expect(studentFinancialSummary(student, data, now).outstandingMinor).toBe(
      8500,
    );
  });
  it("does not infer coverage from an unrelated account payment", () => {
    const { data, student } = fixture();
    data.payments = [
      {
        id: "unrelated",
        studentId: student.id,
        kind: "payment",
        amountMinor: 8500,
        currency: "USD",
        reason: "Unallocated",
        createdAt: "",
      },
    ];
    expect(studentFinancialSummary(student, data, now).outstandingMinor).toBe(
      8500,
    );
  });
  it("excludes cancelled lessons and recorded waivers", () => {
    const { data, student } = fixture();
    data.lessons[0].paymentStatus = "waived";
    data.lessons.push({
      ...data.lessons[0],
      id: "cancel",
      paymentStatus: "due",
      status: "cancelled",
    });
    expect(studentFinancialSummary(student, data, now).outstandingMinor).toBe(
      0,
    );
  });
});
