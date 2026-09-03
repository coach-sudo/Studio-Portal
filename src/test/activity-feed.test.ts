import { describe, expect, it } from "vitest";
import { buildActivityFeed } from "../domain/activityFeed";
import { demoSnapshot } from "../data/demo";

const now = new Date("2026-08-30T22:00:00.000Z").getTime();

function activitySnapshot() {
  const data = structuredClone(demoSnapshot);
  data.bookings = [];
  data.lessons = [];
  data.lessonParticipants = [];
  data.materials = [];
  data.assignments = [];
  data.notes = [];
  data.integrationImports = [];
  data.conversations = [];
  data.conversationMessages = [];
  return data;
}

describe("activity feed", () => {
  it("sorts actions first and updates newest-first within their priority", () => {
    const data = activitySnapshot();
    data.bookings.push({
      ...structuredClone(demoSnapshot.bookings[0]),
      id: "booking-recent",
      version: 2,
      status: "confirmed",
      updatedAt: "2026-08-30T20:00:00.000Z",
    });
    data.materials.push({
      ...structuredClone(demoSnapshot.materials[0]),
      id: "material-recent",
      version: 3,
      approvalStatus: "approved",
      updatedAt: "2026-08-30T19:00:00.000Z",
    });
    data.integrationImports.push({
      id: "import-action", studioId: data.studioId, provider: "gmail", externalId: "message-1",
      detectedSource: "lessonface", status: "needs_review", confidence: 0.9,
      payload: { summary: "New Lessonface lesson" }, createdAt: "2026-08-30T18:00:00.000Z",
      updatedAt: "2026-08-30T18:00:00.000Z",
    });

    const feed = buildActivityFeed(data, "coach", now);

    expect(feed.map((item) => item.kind)).toEqual(["import", "booking", "material"]);
    expect(feed.map((item) => item.priority)).toEqual(["action", "update", "update"]);
    expect(feed.slice(1).every((item, index, updates) => !index || updates[index - 1].occurredAt >= item.occurredAt)).toBe(true);
  });

  it("collapses repeated events to the newest version while keeping entity identity stable", () => {
    const data = activitySnapshot();
    const booking = structuredClone(demoSnapshot.bookings[0]);
    data.bookings = [
      { ...booking, id: "booking-shared", manageToken: undefined, version: 4, updatedAt: "2026-08-30T19:00:00.000Z" },
      { ...booking, id: "booking-shared", manageToken: undefined, version: 5, updatedAt: "2026-08-30T20:00:00.000Z" },
    ];

    const feed = buildActivityFeed(data, "coach", now);

    expect(feed).toHaveLength(1);
    expect(feed[0].entityKey).toBe("booking:booking-shared");
    expect(feed[0].key).toBe("booking:booking-shared:5");
    expect(feed[0].route).toBe("/coach/bookings?view=overview");
  });

  it("uses a new read key but the same grouping key after an entity changes", () => {
    const data = activitySnapshot();
    const booking = structuredClone(demoSnapshot.bookings[0]);
    data.bookings = [{ ...booking, id: "booking-versioned", version: 1, updatedAt: "2026-08-30T19:00:00.000Z" }];
    const before = buildActivityFeed(data, "coach", now)[0];
    data.bookings[0] = { ...data.bookings[0], version: 2, updatedAt: "2026-08-30T20:00:00.000Z" };
    const after = buildActivityFeed(data, "coach", now)[0];

    expect(after.entityKey).toBe(before.entityKey);
    expect(after.key).not.toBe(before.key);
  });

  it("uses the specific management route when a booking does not yet have a lesson", () => {
    const data = activitySnapshot();
    data.bookings = [{
      ...structuredClone(demoSnapshot.bookings[0]),
      id: "booking-managed",
      manageToken: "booking token/value",
      updatedAt: "2026-08-30T20:00:00.000Z",
    }];

    expect(buildActivityFeed(data, "coach", now)[0].route).toBe("/booking/booking%20token%2Fvalue");
    expect(buildActivityFeed(data, "student", now)[0].route).toBe("/booking/booking%20token%2Fvalue");
  });

  it("keeps provider verification private from student and guardian feeds", () => {
    const data = activitySnapshot();
    data.integrationImports.push({
      id: "import-private", studioId: data.studioId, provider: "gmail", externalId: "message-2",
      detectedSource: "lessonface", status: "needs_review", confidence: 0.9,
      payload: { summary: "New Lessonface lesson" }, createdAt: "2026-08-30T18:00:00.000Z",
      updatedAt: "2026-08-30T18:00:00.000Z",
    });

    expect(buildActivityFeed(data, "student", now).some((item) => item.kind === "import")).toBe(false);
    expect(buildActivityFeed(data, "guardian", now).some((item) => item.kind === "import")).toBe(false);
  });

  it("does not create a new unread key when an unchanged provider item is merely rescanned", () => {
    const data = activitySnapshot();
    data.integrationImports.push({
      id: "import-stable", studioId: data.studioId, provider: "gmail", externalId: "message-stable",
      detectedSource: "lessonface", status: "needs_review", confidence: 0.9,
      matchedBy: "email", payload: { startsAt: "2026-09-01T18:00:00.000Z", summary: "Lesson with Maya" },
      createdAt: "2026-08-30T18:00:00.000Z", updatedAt: "2026-08-30T18:00:00.000Z",
    });
    const before = buildActivityFeed(data, "coach", now)[0];
    data.integrationImports[0].updatedAt = "2026-08-30T21:00:00.000Z";
    data.integrationImports[0].confidence = 0.91;
    const after = buildActivityFeed(data, "coach", now)[0];

    expect(after.entityKey).toBe(before.entityKey);
    expect(after.key).toBe(before.key);
    expect(after.occurredAt).not.toBe(before.occurredAt);
  });

  it("creates a new provider read key when the underlying review state changes", () => {
    const data = activitySnapshot();
    data.integrationImports.push({
      id: "import-changed", studioId: data.studioId, provider: "gmail", externalId: "message-changed",
      detectedSource: "lessonface", status: "needs_review", confidence: 0.9,
      payload: { startsAt: "2026-09-01T18:00:00.000Z", summary: "Lesson with Maya" },
      createdAt: "2026-08-30T18:00:00.000Z", updatedAt: "2026-08-30T18:00:00.000Z",
    });
    const before = buildActivityFeed(data, "coach", now)[0];
    data.integrationImports[0].payload = { ...data.integrationImports[0].payload, startsAt: "2026-09-02T18:00:00.000Z" };
    const after = buildActivityFeed(data, "coach", now)[0];

    expect(after.entityKey).toBe(before.entityKey);
    expect(after.key).not.toBe(before.key);
  });

  it("routes lesson-linked activity to the exact lesson workspace for every audience", () => {
    const data = activitySnapshot();
    const lesson = {
      ...structuredClone(demoSnapshot.lessons[0]),
      id: "lesson-specific",
      studentId: "student-specific",
      version: 7,
      updatedAt: "2026-08-30T20:00:00.000Z",
    };
    data.lessons = [lesson];
    data.assignments = [{
      ...structuredClone(demoSnapshot.assignments[0]), id: "assignment-specific",
      studentId: lesson.studentId, lessonId: lesson.id, updatedAt: "2026-08-30T21:00:00.000Z",
    }];
    data.notes = [{
      ...structuredClone(demoSnapshot.notes[0]), id: "note-specific",
      studentId: lesson.studentId, lessonId: lesson.id, updatedAt: "2026-08-30T21:01:00.000Z",
    }];
    data.materials = [{
      ...structuredClone(demoSnapshot.materials[0]), id: "material-specific",
      studentId: lesson.studentId, lessonId: lesson.id, updatedAt: "2026-08-30T21:02:00.000Z",
    }];
    const participant = structuredClone(demoSnapshot.lessonParticipants[0]);
    data.bookings = [{
      ...structuredClone(demoSnapshot.bookings[0]), id: "booking-specific", studentId: lesson.studentId,
      updatedAt: "2026-08-30T21:03:00.000Z",
    }];
    data.lessonParticipants = [{ ...participant, id: "participant-specific", lessonId: lesson.id, bookingId: "booking-specific", studentId: lesson.studentId }];

    const coachFeed = buildActivityFeed(data, "coach", now);
    expect(coachFeed.filter((item) => item.kind !== "import").every((item) => item.route === "/coach/students/student-specific/lessons/lesson-specific")).toBe(true);
    for (const audience of ["student", "guardian"] as const) {
      expect(buildActivityFeed(data, audience, now).every((item) => item.route === "/portal/lessons/lesson-specific")).toBe(true);
    }
  });

  it("uses the actor page and student workspaces for materials without lessons", () => {
    const data = activitySnapshot();
    data.materials = [
      { ...structuredClone(demoSnapshot.materials[0]), id: "actor-media", studentId: "student-a", lessonId: undefined, role: "actor_material", updatedAt: "2026-08-30T20:00:00.000Z" },
      { ...structuredClone(demoSnapshot.materials[0]), id: "current-script", studentId: "student-a", lessonId: undefined, role: "current_script", updatedAt: "2026-08-30T19:00:00.000Z" },
    ];

    const coachFeed = buildActivityFeed(data, "coach", now);
    expect(coachFeed.find((item) => item.entityKey === "material:actor-media")?.route).toBe("/coach/students/student-a/actor-page");
    expect(coachFeed.find((item) => item.entityKey === "material:current-script")?.route).toBe("/coach/students/student-a/work");
    const portalFeed = buildActivityFeed(data, "student", now);
    expect(portalFeed.find((item) => item.entityKey === "material:actor-media")?.route).toBe("/portal/actor-page");
    expect(portalFeed.find((item) => item.entityKey === "material:current-script")?.route).toBe("/portal/work");
  });

  it("expires feed items after 30 days so activity does not become permanent clutter", () => {
    const data = activitySnapshot();
    data.bookings.push({
      ...structuredClone(demoSnapshot.bookings[0]), id: "booking-old", updatedAt: "2026-06-01T00:00:00.000Z",
    });
    data.integrationImports.push({
      id: "import-old", studioId: data.studioId, provider: "google_calendar", externalId: "event-old",
      detectedSource: "google_calendar", status: "needs_review", confidence: 0.7,
      createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z",
    });

    expect(buildActivityFeed(data, "coach", now)).toEqual([]);
  });
});
