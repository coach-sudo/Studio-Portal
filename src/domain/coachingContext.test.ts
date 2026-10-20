import { describe, expect, it } from "vitest";
import { demoSnapshot } from "../data/demo";
import {
  coachingContext,
  lessonDraft,
  coachLessonLink,
  portalContextLink,
} from "./coachingContext";

describe("connected coaching context", () => {
  it("fails closed for an unknown selected student", () => {
    expect(coachingContext(demoSnapshot, "not-authorized")).toBeUndefined();
  });
  it("shares only published feedback for the exact student", () => {
    const data = structuredClone(demoSnapshot),
      studentId = data.students[0].id;
    const note = {
      id: "published",
      studentId,
      lessonId: "lesson",
      title: "Shared",
      body: "Feedback",
      status: "published" as const,
      updatedAt: "2026-10-20T12:00:00Z",
      version: 1,
    };
    data.notes = [
      note,
      { ...note, id: "draft", status: "draft" },
      { ...note, id: "peer", studentId: "another-student" },
    ];
    expect(coachingContext(data, studentId)!.feedback.map((n) => n.id)).toEqual(
      ["published"],
    );
    expect(lessonDraft(data, studentId, "lesson")?.id).toBe("draft");
    expect(lessonDraft(data, studentId, "other-lesson")).toBeUndefined();
  });
  it("reuses the newest exact draft without mutating or creating notes", () => {
    const data = structuredClone(demoSnapshot),
      studentId = data.students[0].id;
    data.notes = [1, 2].map((i) => ({
      id: `draft-${i}`,
      studentId,
      lessonId: "lesson",
      title: "Draft",
      body: "Private",
      status: "draft",
      updatedAt: `2026-10-2${i}T12:00:00Z`,
      version: 1,
    }));
    const before = structuredClone(data.notes);
    for (let i = 0; i < 3; i++)
      expect(lessonDraft(data, studentId, "lesson")?.id).toBe("draft-2");
    expect(data.notes).toEqual(before);
  });
  it("updates current work after completion and deduplicates canonical scripts", () => {
    const data = structuredClone(demoSnapshot),
      studentId = data.students[0].id;
    const script = {
      ...data.materials[0],
      studentId,
      role: "current_script" as const,
      status: "active" as const,
      resourceId: "canonical",
    };
    data.materials = [
      { ...script, id: "new", updatedAt: "2026-10-20T12:00:00Z" },
      { ...script, id: "old", updatedAt: "2026-10-19T12:00:00Z" },
    ];
    const assignment = {
      id: "practice",
      studentId,
      title: "Practice",
      details: "Read",
      status: "assigned" as const,
      helpRequested: false,
      updatedAt: "2026-10-20T12:00:00Z",
      version: 1,
    };
    data.assignments = [assignment];
    expect(coachingContext(data, studentId)!.scripts.map((s) => s.id)).toEqual([
      "new",
    ]);
    expect(coachingContext(data, studentId)!.practice.active).toHaveLength(1);
    data.assignments[0].status = "completed";
    expect(coachingContext(data, studentId)!.practice.active).toHaveLength(0);
    expect(coachingContext(data, studentId)!.practice.completed).toHaveLength(
      1,
    );
  });
  it("includes authorized group participation without choosing another child", () => {
    const data = structuredClone(demoSnapshot),
      studentId = data.students[0].id;
    const lesson = {
      ...data.lessons[0],
      id: "class",
      studentId: "peer",
      startsAt: "2026-11-01T12:00:00Z",
      endsAt: "2026-11-01T13:00:00Z",
      status: "scheduled" as const,
    };
    data.lessons = [lesson];
    data.lessonParticipants = [
      {
        id: "p",
        studentId,
        lessonId: "class",
        displayName: "Student",
        email: "student@example.test",
        status: "confirmed",
      },
    ];
    expect(coachingContext(data, studentId, 0)!.nextLesson?.id).toBe("class");
    data.lessonParticipants[0].status = "cancelled";
    expect(coachingContext(data, studentId, 0)!.nextLesson).toBeUndefined();
  });
  it("retains exact portal context and routes class actions to their workspace", () => {
    expect(
      portalContextLink("/portal/notes?note=note&student=wrong", "child-2"),
    ).toBe("/portal/notes?note=note&student=child-2");
    const lesson = {
      ...demoSnapshot.lessons[0],
      studentId: "child",
      id: "lesson",
    };
    expect(coachLessonLink(lesson, true)).toBe(
      "/coach/students/child/lessons/lesson?writeNote=lesson",
    );
    expect(coachLessonLink({ ...lesson, offeringId: "class" }, true)).toBe(
      "/coach/classes/class",
    );
  });
});
