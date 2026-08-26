import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  gmailCandidate,
  gmailChangeType,
  gmailProviderMessageKind,
  isSameScheduledLesson,
  managedCalendarChange,
} from "../../netlify/functions/provider-intake";

describe("Gmail provider lesson parsing", () => {
  it("keeps a Lessonface wall time in the studio timezone", () => {
    const candidate = gmailCandidate(
      "Your Lessonface acting lesson is Monday, November 2, 2026 at 1:00 PM for 45 minutes.",
      { subject: "Lessonface lesson confirmed" },
      "America/New_York",
    );

    expect(candidate).toMatchObject({
      startsAt: "2026-11-02T18:00:00.000Z",
      endsAt: "2026-11-02T18:45:00.000Z",
      topic: "Lessonface lesson confirmed",
    });
  });

  it("accepts provider timestamps that already include an offset", () => {
    const candidate = gmailCandidate(
      "Confirmed 2026-08-25T13:30:00-04:00 for 60 minutes https://meet.google.com/abc-defg-hij",
      { subject: "Acuity booking" },
      "America/New_York",
    );

    expect(candidate).toMatchObject({
      startsAt: "2026-08-25T17:30:00.000Z",
      endsAt: "2026-08-25T18:30:00.000Z",
      joinUrl: "https://meet.google.com/abc-defg-hij",
      locationLabel: "Online",
    });
  });

  it("parses abbreviated Lessonface dates from Gmail", () => {
    const candidate = gmailCandidate(
      "Your Lessonface booking is Tue, Aug 25, 2026 at 3:15 PM ET for 45 minutes.",
      { subject: "Lessonface lesson confirmed" },
      "America/New_York",
    );

    expect(candidate).toMatchObject({
      startsAt: "2026-08-25T19:15:00.000Z",
      endsAt: "2026-08-25T20:00:00.000Z",
    });
  });

  it("does not invent a lesson when an email has no scheduled time", () => {
    expect(
      gmailCandidate(
        "A student sent a Lessonface inquiry about acting lessons.",
        { subject: "Lessonface inquiry" },
        "America/New_York",
      ),
    ).toBeUndefined();
  });

  it("ignores Lessonface mail that is not a booking event", () => {
    const candidate = gmailCandidate(
      "A Lessonface newsletter mentions a class on Tuesday, August 25, 2026 at 3:15 PM ET.",
      { subject: "Lessonface weekly digest" },
      "America/New_York",
    );
    expect(
      gmailProviderMessageKind(
        "Lessonface weekly digest newsletter about classes and special offers",
        candidate,
      ),
    ).toBeUndefined();
    expect(
      gmailProviderMessageKind(
        "You have a new message and payment receipt from a Lessonface student",
      ),
    ).toBeUndefined();
    expect(
      gmailProviderMessageKind(
        "A student sent a Lessonface inquiry about acting lessons",
      ),
    ).toBeUndefined();
    expect(
      gmailProviderMessageKind(
        "Read our Lessonface lesson cancellation policy before booking",
      ),
    ).toBeUndefined();
  });

  it("accepts only concrete Lessonface bookings and lesson changes", () => {
    const candidate = gmailCandidate(
      "Your Lessonface lesson is scheduled Tuesday, August 25, 2026 at 3:15 PM ET for 45 minutes.",
      { subject: "Lessonface booking confirmed" },
      "America/New_York",
    );
    expect(
      gmailProviderMessageKind(
        "Lessonface booking confirmed for your acting lesson",
        candidate,
      ),
    ).toBe("confirmation");
    expect(
      gmailProviderMessageKind(
        "Your Lessonface lesson was rescheduled to a new time",
      ),
    ).toBe("reschedule");
    expect(
      gmailProviderMessageKind("Your Lessonface lesson was cancelled"),
    ).toBe("cancellation");
  });

  it("recognizes a provider email as the lesson already in the studio", () => {
    const candidate = {
      startsAt: "2026-08-25T19:15:00.000Z",
      endsAt: "2026-08-25T20:00:00.000Z",
      topic: "Lessonface booking confirmed",
      locationLabel: "Lessonface",
      joinUrl: undefined,
      timeZone: "America/New_York",
    };
    expect(
      isSameScheduledLesson(
        candidate,
        {
          id: "lesson-1",
          student_id: "student-1",
          starts_at: "2026-08-25T19:15:00.000Z",
          ends_at: "2026-08-25T20:00:00.000Z",
          status: "scheduled",
          source_provider: "google_calendar",
          topic: "Acting coaching",
        },
        "lessonface",
        "student-1",
      ),
    ).toBe(true);
    expect(
      isSameScheduledLesson(
        candidate,
        {
          id: "lesson-2",
          student_id: "student-2",
          starts_at: "2026-08-25T19:45:00.000Z",
          ends_at: "2026-08-25T20:30:00.000Z",
          status: "scheduled",
          source_provider: "studio",
          topic: "Scene study",
        },
        "lessonface",
        "student-1",
      ),
    ).toBe(false);
  });

  it("classifies provider reschedules and cancellations before reconciliation", () => {
    expect(
      gmailChangeType("Your Lessonface lesson was rescheduled to a new time"),
    ).toBe("reschedule");
    expect(gmailChangeType("Your Wyzant lesson has been cancelled")).toBe(
      "cancellation",
    );
    expect(gmailChangeType("Your Acuity lesson is confirmed")).toBe(
      "confirmation",
    );
  });

  it("requests deleted Calendar events so cancellations can remove app lessons", () => {
    expect(
      fs.readFileSync("netlify/functions/provider-intake.ts", "utf8"),
    ).toContain('showDeleted: "true"');
  });

  it("detects external changes to an app-managed Calendar event without echoing unchanged events", () => {
    const lesson = {
      starts_at: "2026-08-25T17:00:00.000Z",
      ends_at: "2026-08-25T18:00:00.000Z",
      status: "scheduled",
    };
    expect(
      managedCalendarChange(
        {
          id: "event-1",
          start: { dateTime: lesson.starts_at },
          end: { dateTime: lesson.ends_at },
        },
        lesson,
      ),
    ).toBeUndefined();
    expect(
      managedCalendarChange(
        {
          id: "event-1",
          start: { dateTime: "2026-08-25T18:00:00.000Z" },
          end: { dateTime: "2026-08-25T19:00:00.000Z" },
        },
        lesson,
      ),
    ).toBe("reschedule");
    expect(
      managedCalendarChange({ id: "event-1", status: "cancelled" }, lesson),
    ).toBe("cancellation");
    expect(
      managedCalendarChange(
        {
          id: "event-1",
          start: { dateTime: "2026-08-25T18:00:00.000Z" },
          end: { dateTime: "2026-08-25T19:00:00.000Z" },
        },
        { ...lesson, status: "completed" },
      ),
    ).toBeUndefined();
  });
});
