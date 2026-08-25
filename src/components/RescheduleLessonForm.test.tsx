import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { demoSnapshot } from "../data/demo";
import { RescheduleLessonForm } from "./RescheduleLessonForm";

const lesson = {
  ...demoSnapshot.lessons[0],
  startsAt: "2030-03-11T19:00:00.000Z",
  endsAt: "2030-03-11T20:00:00.000Z",
};

describe("RescheduleLessonForm", () => {
  it("moves a lesson by a quick date while preserving its duration", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <RescheduleLessonForm
        lesson={lesson}
        studentName="Maya"
        timezone="America/New_York"
        cancellationWindowHours={36}
        busy={false}
        onCancel={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Next week" }));
    await user.click(screen.getByRole("button", { name: "Confirm new time" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    const [startsAt, endsAt] = onSubmit.mock.calls[0];
    expect(new Date(endsAt).getTime() - new Date(startsAt).getTime()).toBe(3_600_000);
    expect(startsAt).toBe("2030-03-18T19:00:00.000Z");
  });

  it("does not submit an unchanged lesson time", async () => {
    const onSubmit = vi.fn();
    render(
      <RescheduleLessonForm
        lesson={lesson}
        studentName="Maya"
        timezone="America/New_York"
        cancellationWindowHours={36}
        busy={false}
        onCancel={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm new time" })).toBeDisabled();
    expect(screen.getByText("Choose a different date or time.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("locks controls while the calendar check is running", () => {
    render(
      <RescheduleLessonForm
        lesson={lesson}
        studentName="Maya"
        timezone="America/New_York"
        cancellationWindowHours={36}
        busy
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Checking calendar…" })).toBeDisabled();
    expect(screen.getByLabelText("New date")).toBeDisabled();
    expect(screen.getByLabelText("New time")).toBeDisabled();
  });
});
