import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import type { LessonAutopayPlan } from "../../domain/lessonAutopay";
import { LessonAutopayPreview } from "./LessonAutopayPreview";

const mock = vi.hoisted(() => ({
  command: vi.fn(),
  account: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("../../data/bookingCommands", () => ({ studioCommand: mock.command }));
vi.mock("../../data/globalSearch", () => ({
  useSearchIdentity: () => "payer",
}));
vi.mock("./useLessonAutopayOptions", () => ({
  useLessonAutopayAccount: mock.account,
}));

test("pause, resume, and end require confirmation under the existing mandate version", async () => {
  const user = userEvent.setup();
  const active: LessonAutopayPlan = {
    id: "mandate",
    version: 4,
    status: "active",
    scope: "future",
    leadDays: 2,
    currency: "USD",
    maximumLessonMinor: 8000,
    timeZone: "America/New_York",
    methodLabel: "Visa ending in 4242",
    authorizedAt: null,
    setupExpiresAt: "",
    needsReauthorization: false,
    lessons: [],
  };
  mock.account.mockReturnValue({
    data: { arrangement: active, pending: null, canSetUp: true },
    refetch: mock.refetch,
  });
  mock.command.mockResolvedValue({ resource: {} });
  const screenFor = () => (
    <MemoryRouter>
      <LessonAutopayPreview
        studentId="student"
        studentName="Student"
        options={{
          currency: "USD",
          lessons: [],
          hasMore: false,
          policy: {
            timeZone: "America/New_York",
            chargeAtLocal: "09:00",
            minimumLeadDays: 0,
            maximumLeadDays: 7,
            maximumLessonMinor: 8500,
          },
        }}
      />
    </MemoryRouter>
  );
  const view = render(screenFor());
  await user.click(screen.getByRole("button", { name: "Pause" }));
  const pause = screen.getByRole("dialog", {
    name: "Pause automatic payments",
  });
  expect(
    within(pause).getByText("Past payments stay on your account."),
  ).toBeVisible();
  expect(mock.command).not.toHaveBeenCalled();
  await user.click(
    within(pause).getByRole("button", { name: "Pause automatic payments" }),
  );
  expect(mock.command).toHaveBeenLastCalledWith(
    "invoices",
    expect.objectContaining({
      command: "training_autopay_pause",
      expectedVersion: 4,
    }),
    "payer",
  );
  mock.account.mockReturnValue({
    data: {
      arrangement: { ...active, status: "paused", version: 5 },
      pending: null,
      canSetUp: true,
    },
    refetch: mock.refetch,
  });
  view.rerender(screenFor());
  await user.click(screen.getByRole("button", { name: "Resume" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Resume automatic payments",
    }),
  );
  expect(mock.command).toHaveBeenLastCalledWith(
    "invoices",
    expect.objectContaining({
      command: "training_autopay_resume",
      expectedVersion: 5,
    }),
    "payer",
  );
  await user.click(
    screen.getByRole("button", { name: "End automatic payments" }),
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Keep current setting",
    }),
  );
  expect(mock.command).toHaveBeenCalledTimes(2);
});
