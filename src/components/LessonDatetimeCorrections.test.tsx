import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { LessonDatetimeCorrectionForm } from "./LessonDatetimeCorrections";
import type { Lesson } from "../domain/model";
const f = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("../data/bookingCommands", () => ({ studioCommand: f.command }));
const lesson = {
  id: "e7600000-0000-4000-8000-000000000004",
  startsAt: "2020-01-01T15:00:00Z",
  endsAt: "2020-01-01T16:00:00Z",
  status: "completed",
  version: 3,
  topic: "Synthetic correction",
} as Lesson;
const preview = {
  lessonId: lesson.id,
  version: 3,
  eligible: true,
  reasonCode: null,
  reviewToken: "synthetic-seal",
  financialReviewRequired: true,
  providerReviewRequired: true,
  completedInFuture: false,
  bookingCount: 1,
  invoiceCount: 1,
  creditEntryCount: 0,
  participantCount: 1,
  sharedBooking: false,
  status: "completed",
};
beforeEach(() => {
  f.command.mockReset();
});
it("previews a zoned historical correction, requires financial acknowledgement and preserves request identity after a lost response", async () => {
  f.command
    .mockResolvedValueOnce({ resource: preview })
    .mockRejectedValueOnce(new Error("Synthetic lost response"))
    .mockResolvedValueOnce({ resource: { corrected: true } });
  const applied = vi.fn();
  const { rerender } = render(
    <LessonDatetimeCorrectionForm
      lesson={lesson}
      timezone="America/New_York"
      onCancel={() => {}}
      onApplied={applied}
    />,
  );
  expect(screen.getByLabelText("Starts")).toHaveValue("2020-01-01T10:00");
  fireEvent.change(screen.getByLabelText("Starts"), {
    target: { value: "2020-01-01T09:00" },
  });
  fireEvent.change(screen.getByLabelText("Correction reason"), {
    target: { value: "Original time was mistyped" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Preview correction" }).closest("form")!,
  );
  await screen.findByText("Review this occurrence");
  expect(
    screen.getByRole("button", { name: "Apply correction" }),
  ).toBeDisabled();
  expect(f.command.mock.calls[0][1].payload).toMatchObject({
    startsAt: "2020-01-01T14:00:00.000Z",
    timezone: "America/New_York",
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: /financial history stays unchanged/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Apply correction" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Synthetic lost response",
  );
  rerender(
    <LessonDatetimeCorrectionForm
      lesson={{ ...lesson, version: 4 }}
      timezone="America/New_York"
      onCancel={() => {}}
      onApplied={applied}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Apply correction" }));
  await waitFor(() => expect(applied).toHaveBeenCalledOnce());
  expect(f.command.mock.calls[1]).toEqual(f.command.mock.calls[2]);
});
it("requires an explicit timezone rather than guessing a missing studio policy", () => {
  render(
    <LessonDatetimeCorrectionForm
      lesson={lesson}
      timezone=""
      onCancel={() => {}}
      onApplied={() => {}}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "explicit valid correction timezone",
  );
  expect(screen.getByLabelText("Starts")).toHaveValue("");
  expect(f.command).not.toHaveBeenCalled();
});
it("rejects a DST gap locally without calling the command", async () => {
  render(
    <LessonDatetimeCorrectionForm
      lesson={lesson}
      timezone="America/New_York"
      onCancel={() => {}}
      onApplied={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("Starts"), {
    target: { value: "2026-03-08T02:30" },
  });
  fireEvent.change(screen.getByLabelText("Ends"), {
    target: { value: "2026-03-08T03:30" },
  });
  fireEvent.change(screen.getByLabelText("Correction reason"), {
    target: { value: "Synthetic gap" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Preview correction" }).closest("form")!,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("DST gap");
  expect(f.command).not.toHaveBeenCalled();
});
it("requires an explicit repeated-hour occurrence and preserves the completed outcome", async () => {
  f.command.mockResolvedValue({
    resource: { ...preview, completedInFuture: true },
  });
  render(
    <LessonDatetimeCorrectionForm
      lesson={lesson}
      timezone="America/New_York"
      onCancel={() => {}}
      onApplied={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("Starts"), {
    target: { value: "2031-11-02T01:30" },
  });
  fireEvent.change(screen.getByLabelText("Ends"), {
    target: { value: "2031-11-02T03:30" },
  });
  expect(
    screen.getByLabelText("Starts repeated-hour occurrence"),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Starts repeated-hour occurrence"), {
    target: { value: "2031-11-02T06:30:00.000Z" },
  });
  fireEvent.change(screen.getByLabelText("Correction reason"), {
    target: { value: "Synthetic corrected outcome" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Preview correction" }).closest("form")!,
  );
  await screen.findByText("Review this occurrence");
  expect(
    screen.getByRole("checkbox", {
      name: /Preserve the recorded completed outcome/,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Apply correction" }),
  ).toBeDisabled();
});
