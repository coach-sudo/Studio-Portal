import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { demoSnapshot } from "../data/demo";
import type { SchedulingConflict } from "../domain/schedulingConflicts";
import { RescheduleLessonForm } from "./RescheduleLessonForm";
const lesson = {
  ...demoSnapshot.lessons[0],
  startsAt: "2031-11-03T18:00:00Z",
  endsAt: "2031-11-03T19:00:00Z",
  status: "scheduled" as const,
  offeringId: undefined,
};
const conflict: SchedulingConflict = {
  id: "other",
  summary: "Another private lesson",
  start: "2031-11-10T18:00:00Z",
  end: "2031-11-10T19:00:00Z",
  source: "studio",
  policy: "private_overlap",
  blocksChange: true,
};
function mount(rows: SchedulingConflict[]) {
  const submit = vi.fn(),
    check = vi.fn(async () => rows),
    user = userEvent.setup();
  const result = render(
    <RescheduleLessonForm
      lesson={lesson}
      studentName="Synthetic learner"
      timezone="America/New_York"
      cancellationWindowHours={36}
      busy={false}
      onCancel={() => {}}
      onSubmit={submit}
      onCheckConflicts={check}
    />,
  );
  return { ...result, submit, check, user };
}
async function inspect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Next week" }));
  await user.click(screen.getByRole("button", { name: "Confirm new time" }));
}
it("blocks a private exclusion and cannot submit it through a direct form event", async () => {
  const { user, submit, container } = mount([conflict]);
  await inspect(user);
  expect(
    await screen.findByRole("button", { name: "Choose another time" }),
  ).toBeDisabled();
  expect(
    screen.getByText(/Scheduled private lessons cannot overlap/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /anyway|override/i }),
  ).not.toBeInTheDocument();
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(submit).not.toHaveBeenCalled());
});
it("requires refreshed classification for a response from an older server", async () => {
  const { user, submit } = mount([
    {
      id: conflict.id,
      summary: conflict.summary,
      start: conflict.start,
      end: conflict.end,
    },
  ]);
  await inspect(user);
  expect(
    await screen.findByRole("button", { name: "Choose another time" }),
  ).toBeDisabled();
  expect(
    screen.getByText(/did not identify the applicable policy/),
  ).toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
});
it("requires an explicit Google busy-time acknowledgement and sends only that override", async () => {
  const { user, submit } = mount([
    {
      ...conflict,
      source: "google",
      policy: "google_busy",
      blocksChange: false,
    },
  ]);
  await inspect(user);
  expect(submit).not.toHaveBeenCalled();
  await user.click(
    await screen.findByRole("button", { name: "Confirm Google overlap" }),
  );
  expect(submit).toHaveBeenCalledWith(
    "2031-11-10T18:00:00.000Z",
    "2031-11-10T19:00:00.000Z",
    true,
  );
});
it("acknowledges a group/draft advisory without sending a Google override", async () => {
  const { user, submit } = mount([
    { ...conflict, policy: "studio_advisory", blocksChange: false },
  ]);
  await inspect(user);
  await user.click(
    await screen.findByRole("button", { name: "Review studio overlap" }),
  );
  expect(submit).toHaveBeenCalledWith(
    "2031-11-10T18:00:00.000Z",
    "2031-11-10T19:00:00.000Z",
    false,
  );
});
it("never lets a Google acknowledgement bypass a simultaneous private exclusion", async () => {
  const { user, submit } = mount([
    conflict,
    {
      ...conflict,
      source: "google",
      policy: "google_busy",
      blocksChange: false,
    },
  ]);
  await inspect(user);
  expect(
    await screen.findByRole("button", { name: "Choose another time" }),
  ).toBeDisabled();
  expect(submit).not.toHaveBeenCalled();
});
it("clears the blocked preview after a time edit and checks the new interval", async () => {
  const { user, submit, check } = mount([conflict]);
  await inspect(user);
  await screen.findByRole("button", { name: "Choose another time" });
  check.mockResolvedValue([]);
  await user.click(screen.getByRole("button", { name: "Two weeks later" }));
  await user.click(screen.getByRole("button", { name: "Confirm new time" }));
  expect(check).toHaveBeenCalledTimes(2);
  expect(submit).toHaveBeenCalledWith(
    "2031-11-17T18:00:00.000Z",
    "2031-11-17T19:00:00.000Z",
    false,
  );
});
it("disables date/time/duration and quick controls until their request finishes", async () => {
  const { user, submit, check } = mount([]);
  let finish!: Parameters<
    ConstructorParameters<typeof Promise<SchedulingConflict[]>>[0]
  >[0];
  check.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await inspect(user);
  expect(screen.getByLabelText("New date")).toBeDisabled();
  expect(screen.getByLabelText("New time")).toBeDisabled();
  expect(screen.getByLabelText("Duration (minutes)")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();
  finish([]);
  await waitFor(() => expect(submit).toHaveBeenCalledOnce());
});
it("preserves selected time after provider failure and performs a fresh check on retry", async () => {
  const { user, submit, check } = mount([]);
  check.mockRejectedValueOnce(new Error("Synthetic calendar unavailable"));
  await inspect(user);
  await screen.findByRole("alert");
  expect(screen.getByLabelText("New date")).toHaveValue("2031-11-10");
  expect(screen.getByLabelText("New time")).toHaveValue("13:00");
  expect(submit).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirm new time" }));
  expect(check).toHaveBeenCalledTimes(2);
  expect(submit).toHaveBeenCalledOnce();
});
it("displays both dates in the chosen studio zone across midnight instead of browser-local times", async () => {
  const { user } = mount([
    {
      ...conflict,
      source: "google",
      policy: "google_busy",
      blocksChange: false,
      start: "2031-11-11T04:30:00Z",
      end: "2031-11-11T05:30:00Z",
    },
  ]);
  await user.click(screen.getByRole("button", { name: "Next week" }));
  fireEvent.change(screen.getByLabelText("New time"), {
    target: { value: "23:45" },
  });
  await user.click(screen.getByRole("button", { name: "Confirm new time" }));
  const text = (
    await screen.findByText(/Google Calendar: “Another private lesson”/)
  ).textContent!;
  expect(text).toContain("Nov 10");
  expect(text).toContain("Nov 11");
  expect(text).toContain("11:30 PM");
  expect(text).toContain("12:30 AM");
  expect(text).toContain("America/New_York");
});
it("invalidates a Google acknowledgement after an interval change", async () => {
  const { user, submit, check } = mount([
    {
      ...conflict,
      source: "google",
      policy: "google_busy",
      blocksChange: false,
    },
  ]);
  await inspect(user);
  await screen.findByRole("button", { name: "Confirm Google overlap" });
  await user.click(screen.getByRole("button", { name: "Two weeks later" }));
  check.mockResolvedValue([]);
  await user.click(screen.getByRole("button", { name: "Confirm new time" }));
  expect(check).toHaveBeenCalledTimes(2);
  expect(submit.mock.calls[0][2]).toBe(false);
});
