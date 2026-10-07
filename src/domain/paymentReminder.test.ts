import { describe, expect, it } from "vitest";
import { demoSnapshot } from "../data/demo";
import { evaluateLessonReadiness } from "./lessonReadiness";
import {
  lessonPaymentReminders,
  paymentReminderRequired,
} from "./paymentReminder";
describe("upcoming payment next steps", () => {
  it.each(["paid", "paid_by_credit", "waived"] as const)(
    "does not demand a package or reminder for %s coverage",
    (paymentStatus) => {
      const data = structuredClone(demoSnapshot);
      data.bookings = [];
      data.lessonParticipants = [];
      data.packages = [];
      data.creditEntries = [];
      const lesson = {
        ...data.lessons[0],
        paymentStatus,
        packageId: undefined,
        priceMinor: 8500,
      };
      expect(
        paymentReminderRequired(
          evaluateLessonReadiness(
            lesson,
            data,
            Date.parse(lesson.startsAt) - 1000,
          ),
        ),
      ).toBe(false);
    },
  );
  it("excludes coach alerts and other occurrences while retaining draft, sent and cancelled history", () => {
    const lesson = demoSnapshot.lessons[0];
    const make = (id: string, eventKey: string) => ({
      id,
      version: 1,
      updatedAt: "2026-10-05T12:00:00Z",
      lessonId: lesson.id,
      eventKey,
      channel: "email" as const,
      recipient: "payer@example.test",
      subject: "Reminder",
      body: "Balance due",
      status: "draft" as const,
      attempts: 0,
    });
    const messages = [
      make("payer", "automation.payment_due.hours-24"),
      make("coach", "automation.payment_due.coach-escalation"),
      {
        ...make("other", "automation.payment_due.hours-24"),
        lessonId: "different",
      },
    ];
    expect(
      lessonPaymentReminders(lesson, messages).map((message) => message.id),
    ).toEqual(["payer"]);
  });
});
