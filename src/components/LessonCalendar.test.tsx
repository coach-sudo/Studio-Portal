import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lesson } from "../domain/model";
import { LessonCalendar } from "./LessonCalendar";

const boundaryLesson = {
  id: "lesson-boundary",
  studentId: "student-1",
  startsAt: "2026-09-02T01:15:00.000Z",
  endsAt: "2026-09-02T02:15:00.000Z",
  topic: "Boundary scene",
  locationLabel: "Google Meet",
  status: "scheduled",
} as Lesson;

describe("LessonCalendar timezone grouping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-01T16:00:00.000Z");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("places events on their studio-local day instead of the browser UTC day", () => {
    render(
      <LessonCalendar
        lessons={[boundaryLesson]}
        timezone="America/New_York"
        studentName={() => "Maya Kim"}
        sourceName={() => "Studio"}
        onOpen={() => undefined}
      />,
    );

    const day = screen.getByText("Boundary scene").closest("section");
    expect(day).not.toBeNull();
    expect(
      within(day!).getByRole("button", { name: /Open .*September 1/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("9:15 PM")).toBeInTheDocument();
  });
});
