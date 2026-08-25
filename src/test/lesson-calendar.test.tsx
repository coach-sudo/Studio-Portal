import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LessonCalendar } from "../components/LessonCalendar";
import type { Lesson } from "../domain/model";

const now = new Date();
const lesson = (
  id: string,
  status: Lesson["status"],
  offset: number,
): Lesson => ({
  id,
  studioId: "studio",
  studentId: "student",
  topic: `${status} acting lesson`,
  startsAt: new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + offset,
    13,
  ).toISOString(),
  endsAt: new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + offset,
    14,
  ).toISOString(),
  status,
  locationType: "virtual",
  locationLabel: "Google Meet",
  sourceProvider: "studio",
  version: 1,
  updatedAt: now.toISOString(),
});

describe("LessonCalendar", () => {
  it("switches views, searches, and keeps cancelled lessons hidden by default", async () => {
    const open = vi.fn();
    render(
      <LessonCalendar
        lessons={[
          lesson("scheduled", "scheduled", 0),
          lesson("cancelled", "cancelled", 1),
        ]}
        timezone="America/New_York"
        studentName={() => "Maya Kim"}
        sourceName={() => "Studio"}
        onOpen={open}
      />,
    );
    expect(screen.getByText("scheduled acting lesson")).toBeInTheDocument();
    expect(
      screen.queryByText("cancelled acting lesson"),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "year" }));
    expect(
      screen.getByText(now.toLocaleDateString(undefined, { month: "long" })),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Show cancelled"));
    await userEvent.type(screen.getByLabelText("Search lessons"), "cancelled");
    expect(screen.getByText("1 matching lesson")).toBeInTheDocument();
    await userEvent.click(
      screen.getByText("Maya Kim · cancelled acting lesson"),
    );
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cancelled" }),
    );
  });
});
