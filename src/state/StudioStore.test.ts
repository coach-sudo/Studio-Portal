import { describe, expect, it } from "vitest";
import { demoSnapshot } from "../data/demo";
import { scopeStudioSnapshot } from "./StudioStore";

describe("student workspace scoping", () => {
  it("falls back to the active migrated student when legacy ids replace demo ids", () => {
    const snapshot = structuredClone(demoSnapshot);
    snapshot.students.forEach((student, index) => {
      student.id = `STU-${String(index + 1).padStart(6, "0")}`;
    });
    const firstWorkspaceStudent = snapshot.students.find(
      (student) => student.portalEnabled && student.status === "active",
    )!;
    snapshot.lessons[0].studentId = firstWorkspaceStudent.id;

    const scoped = scopeStudioSnapshot(snapshot, "student", "student-maya");

    expect(scoped.students[0]?.id).toBe(firstWorkspaceStudent.id);
    expect(scoped.lessons[0]?.studentId).toBe(firstWorkspaceStudent.id);
  });

  it("includes email-matched guest bookings without exposing another guest", () => {
    const snapshot = structuredClone(demoSnapshot);
    const maya = snapshot.students.find((student) => student.id === "student-maya")!;
    const template = snapshot.bookings[0];
    snapshot.bookings = [
      { ...template, id: "own-guest", studentId: undefined, guestEmail: maya.email! },
      { ...template, id: "other-guest", studentId: undefined, guestEmail: "someone-else@example.com" },
    ];

    const scoped = scopeStudioSnapshot(snapshot, "student", maya.id);

    expect(scoped.bookings.map((booking) => booking.id)).toEqual(["own-guest"]);
  });
});
