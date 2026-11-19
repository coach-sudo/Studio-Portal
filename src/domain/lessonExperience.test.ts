import { describe, expect, it } from "vitest";
import type { Lesson } from "./model";
import { lessonPaymentLabel, selectLessonDelivery } from "./lessonExperience";

const lesson = (overrides: Partial<Lesson> = {}) =>
  ({
    id: "lesson",
    studioId: "studio",
    studentId: "student",
    topic: "Coaching",
    startsAt: "2026-09-22T16:00:00.000Z",
    endsAt: "2026-09-22T17:00:00.000Z",
    status: "scheduled",
    locationType: "virtual",
    locationLabel: "Google Meet",
    meetingProvider: "google_meet",
    version: 1,
    updatedAt: "2026-09-20T12:00:00.000Z",
    ...overrides,
  }) as Lesson;

describe("selectLessonDelivery", () => {
  it("uses durable lesson state for pending, ready, available, and cancelled", () => {
    expect(selectLessonDelivery(lesson()).state).toBe("pending");
    expect(
      selectLessonDelivery(lesson({ joinUrl: "https://meet.test" })).state,
    ).toBe("ready");
    expect(
      selectLessonDelivery(lesson({ joinUrl: "https://meet.test" }), {
        now: new Date("2026-09-22T15:45:00.000Z"),
      }).state,
    ).toBe("available");
    expect(selectLessonDelivery(lesson({ status: "cancelled" })).state).toBe(
      "cancelled",
    );
  });

  it("does not infer a changed-link state from timestamps", () => {
    expect(
      selectLessonDelivery(
        lesson({
          joinUrl: "https://meet.test",
          updatedAt: "2026-09-22T15:59:59.000Z",
        }),
      ).state,
    ).toBe("ready");
  });
});

it("shows only Paid or Unpaid to learners regardless of accounting method", () => {
  expect(lessonPaymentLabel("paid_by_credit")).toBe("Paid");
  expect(lessonPaymentLabel("waived")).toBe("Paid");
  expect(lessonPaymentLabel("untracked", "paid")).toBe("Paid");
  expect(lessonPaymentLabel("untracked", "not_required")).toBe("Paid");
  expect(lessonPaymentLabel("partially_paid")).toBe("Unpaid");
  expect(lessonPaymentLabel("due")).toBe("Unpaid");
});
