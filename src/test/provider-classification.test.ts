import { describe, expect, it } from "vitest";
import {
  classifyProviderIntake,
  matchStudentIdentity,
} from "../../netlify/functions/_shared/provider-classification";

const occurrence = {
  startsAt: "2026-09-10T18:00:00.000Z",
  endsAt: "2026-09-10T19:00:00.000Z",
};

describe("provider intake trust classifier", () => {
  it("matches a repeat student by student or guardian identity without duplication", () => {
    const students = [
      {
        id: "student-1",
        full_name: "Avery Stone",
        preferred_name: "Avery",
        email: "avery@example.com",
        guardian_name: "Morgan Stone",
        guardian_email: "morgan@example.com",
      },
    ];
    expect(
      matchStudentIdentity(students, "Lessonface lesson", [
        "Morgan@Example.com",
      ]),
    ).toMatchObject({
      student: { id: "student-1" },
      matchedBy: "email",
      confidence: 0.99,
    });
    expect(
      matchStudentIdentity(students, "Booking confirmed for Morgan Stone", []),
    ).toMatchObject({
      student: { id: "student-1" },
      matchedBy: "student or guardian name",
      confidence: 0.91,
    });
  });
  it.each([
    ["Lessonface weekly newsletter and special offers", "non_booking_newsletter"],
    ["Your Wyzant payment receipt and invoice", "non_booking_financial_message"],
    ["TimelyCare medical appointment", "medical_or_health_appointment"],
    ["Family birthday dinner", "personal_calendar_event"],
    ["Butterflies rehearsal", "unmatched_rehearsal"],
    ["Dentist appointment", "medical_or_health_appointment"],
  ])("ignores false positive: %s", (text, reasonCode) => {
    expect(
      classifyProviderIntake({
        source: "google_calendar",
        text,
        parsedOccurrence: occurrence,
      }),
    ).toMatchObject({ disposition: "ignore", reasonCode });
  });

  it("auto-imports a concrete supported-provider confirmation with identity", () => {
    expect(
      classifyProviderIntake({
        source: "gmail",
        text: "Lessonface booking confirmed for your acting lesson",
        parsedOccurrence: occurrence,
        matchContext: {
          studentId: "student-1",
          matchedBy: "guardian email",
          confidence: 0.99,
        },
      }),
    ).toEqual({
      disposition: "auto_import",
      confidence: 0.99,
      reasonCode: "supported_provider_confirmation",
      provider: "lessonface",
      changeType: "confirmation",
      parsedOccurrence: occurrence,
      matchContext: {
        studentId: "student-1",
        matchedBy: "guardian email",
        confidence: 0.99,
      },
    });
  });

  it("auto-imports an explicit Calendar lesson only with a confident match", () => {
    expect(
      classifyProviderIntake({
        source: "google_calendar",
        text: "Maya acting lesson",
        parsedOccurrence: occurrence,
        matchContext: { studentId: "student-1", confidence: 0.91 },
      }),
    ).toMatchObject({
      disposition: "auto_import",
      reasonCode: "matched_calendar_lesson",
    });
    expect(
      classifyProviderIntake({
        source: "google_calendar",
        text: "Maya acting lesson",
        parsedOccurrence: occurrence,
      }),
    ).toMatchObject({
      disposition: "ignore",
      reasonCode: "no_concrete_lesson_booking",
    });
  });

  it("routes a plausible but unmatched provider booking to review", () => {
    expect(
      classifyProviderIntake({
        source: "gmail",
        text: "Acuity booking confirmed for an acting session",
        parsedOccurrence: occurrence,
      }),
    ).toMatchObject({
      disposition: "needs_review",
      reasonCode: "provider_confirmation_missing_identity",
      provider: "acuity",
    });
  });

  it("ignores a second message for the exact lesson", () => {
    expect(
      classifyProviderIntake({
        source: "gmail",
        text: "Lessonface booking confirmed for your lesson",
        parsedOccurrence: occurrence,
        matchContext: { studentId: "student-1", lessonId: "lesson-1" },
        duplicate: true,
      }),
    ).toMatchObject({
      disposition: "ignore",
      confidence: 1,
      reasonCode: "duplicate_existing_lesson",
    });
  });

  it("auto-imports matched cancellations and reschedules", () => {
    expect(
      classifyProviderIntake({
        source: "gmail",
        text: "Your Lessonface lesson was cancelled. A refund receipt will follow.",
        matchContext: { lessonId: "lesson-1", confidence: 1 },
      }),
    ).toMatchObject({
      disposition: "auto_import",
      reasonCode: "matched_provider_cancellation",
      changeType: "cancellation",
    });
    expect(
      classifyProviderIntake({
        source: "gmail",
        text: "Your Wyzant lesson was rescheduled to a new time",
        parsedOccurrence: occurrence,
        matchContext: { lessonId: "lesson-1", confidence: 1 },
      }),
    ).toMatchObject({
      disposition: "auto_import",
      reasonCode: "matched_provider_reschedule",
      changeType: "reschedule",
    });
  });

  it("sends an unmatched provider change to review", () => {
    expect(
      classifyProviderIntake({
        source: "gmail",
        text: "Your Lessonface lesson was cancelled",
      }),
    ).toMatchObject({
      disposition: "needs_review",
      reasonCode: "unmatched_provider_cancellation",
    });
  });

  it("does not mistake policy mail for a real cancellation", () => {
    expect(
      classifyProviderIntake({
        source: "gmail",
        text: "Read the Lessonface lesson cancellation policy before booking",
      }),
    ).toMatchObject({
      disposition: "ignore",
      reasonCode: "provider_policy_message",
    });
  });
});
