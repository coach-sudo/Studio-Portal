import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ImportReviewDialog } from "./StudioToday";
import { demoSnapshot } from "../../data/demo";
import type { IntegrationImport } from "../../domain/model";
const f = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("../../data/bookingCommands", () => ({
  studioCommand: f.command,
  checkSchedulingConflicts: vi.fn(),
}));
const original = "e8900000-0000-4000-8000-000000000010",
  selected = "e8900000-0000-4000-8000-000000000011";
beforeEach(() => {
  vi.clearAllMocks();
  f.command.mockResolvedValue({ resource: { reviewed: 1 } });
});
function setup(linked = false, staleStudent = false) {
  const data = structuredClone(demoSnapshot);
  data.students = [original, selected].map((id, i) => ({
    ...data.students[0],
    id,
    fullName: i ? "Alex Selected" : "Alex Original",
    preferredName: undefined,
    email: i ? "selected@example.test" : "original@example.test",
  }));
  data.lessons = linked
    ? [
        {
          ...data.lessons[0],
          id: "original-lesson",
          studentId: original,
          status: "scheduled",
        },
      ]
    : [];
  const item: IntegrationImport = {
    id: "provider-signal",
    studioId: "synthetic-studio",
    provider: "gmail",
    detectedSource: "superprof",
    externalId: "synthetic-provider-signal",
    status: "needs_review",
    confidence: 0.5,
    studentId: staleStudent ? selected : original,
    lessonId: linked ? "original-lesson" : undefined,
    payload: {
      candidate: {
        startsAt: "2031-11-02T18:00:00Z",
        endsAt: "2031-11-02T19:00:00Z",
        topic: "Synthetic provider coaching",
      },
      changeType: "confirmation",
    },
    createdAt: "2026-10-20T00:00:00Z",
    updatedAt: "2026-10-20T00:00:00Z",
  };
  data.integrationImports = [item];
  const onReviewed = vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <ImportReviewDialog
        item={item}
        similarCount={1}
        data={data}
        onClose={vi.fn()}
        onReviewed={onReviewed}
      />
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), onReviewed };
}
it("selects an unlinked signal identity explicitly without a merge or grouping request", async () => {
  const { user } = setup();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Student" }),
    selected,
  );
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Open original student profile" }),
  ).toHaveAttribute("href", "/coach/records/student/" + original);
  expect(
    screen.getByRole("link", {
      name: "Review duplicate profile links in Students",
    }),
  ).toHaveAttribute("href", "/coach/students");
  await user.click(
    screen.getByRole("button", {
      name: "Confirm student & lesson",
    }),
  );
  await waitFor(() => expect(f.command).toHaveBeenCalledTimes(1));
  expect(f.command.mock.calls[0][0]).toBe("integrations");
  expect(f.command.mock.calls[0][1].payload).toMatchObject({
    action: "existing",
    studentId: selected,
  });
  expect(f.command.mock.calls[0][1].payload).not.toHaveProperty(
    "mergeStudentId",
  );
});
it("blocks a linked lesson's identity change while allowing review under its original profile", async () => {
  const { user } = setup(true);
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Student" }),
    selected,
  );
  expect(
    screen.getByText(/This lesson keeps its original student/),
  ).toBeVisible();
  const confirm = screen.getByRole("button", {
    name: "Confirm student & lesson",
  });
  expect(confirm).toBeDisabled();
  await user.click(confirm);
  expect(f.command).not.toHaveBeenCalled();
  expect(
    screen.getByRole("switch", { name: /Create an interested student/ }),
  ).toBeDisabled();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Student" }),
    original,
  );
  await user.click(confirm);
  await waitFor(() => expect(f.command).toHaveBeenCalledTimes(1));
  expect(f.command.mock.calls[0][1].payload.studentId).toBe(original);
});
it("uses the existing lesson owner when the import's suggested identity differs", () => {
  setup(true, true);
  expect(screen.getByRole("combobox", { name: "Student" })).toHaveValue(
    original,
  );
});
it("retains the exact request and replay key after a lost response", async () => {
  f.command.mockRejectedValueOnce(Error("Synthetic response lost"));
  const { user, onReviewed } = setup();
  await user.type(
    screen.getByRole("textbox", { name: "Verification note (optional)" }),
    "Reviewed original source",
  );
  const confirm = screen.getByRole("button", {
    name: "Confirm student & lesson",
  });
  await user.click(confirm);
  await screen.findByRole("alert");
  expect(onReviewed).not.toHaveBeenCalled();
  const first = f.command.mock.calls[0][1];
  await user.click(confirm);
  await waitFor(() => expect(onReviewed).toHaveBeenCalledTimes(1));
  expect(f.command.mock.calls[1][1]).toEqual(first);
  expect(
    screen.getByRole("textbox", { name: "Verification note (optional)" }),
  ).toHaveValue("Reviewed original source");
});
