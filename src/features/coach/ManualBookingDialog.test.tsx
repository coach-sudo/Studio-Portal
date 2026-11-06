import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManualBookingDialog } from "./BookingOverview";
import { demoSnapshot } from "../../data/demo";
const mock = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../../data/bookingCommands", async (original) => ({
  ...(await original<typeof import("../../data/bookingCommands")>()),
  inspectSchedulingConflicts: mock.preview,
}));
// Keep the default future time outside a repeated DST hour on every run date.
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-27T12:00:00Z"));
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
it("retries an unchanged failed response with the same key before another conflict preview", async () => {
  mock.preview.mockResolvedValue({
    conflicts: [],
    externalCalendarChecked: false,
  });
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <ManualBookingDialog
      data={demoSnapshot}
      isDemo={false}
      onClose={vi.fn()}
      onSave={save}
    />,
  );
  fireEvent.submit(
    screen.getByRole("button", { name: "Create booking" }).closest("form")!,
  );
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(
    await screen.findByText(/Only local studio conflicts were checked/),
  ).toBeInTheDocument();
  fireEvent.submit(
    screen.getByRole("button", { name: "Create booking" }).closest("form")!,
  );
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
  expect(mock.preview).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Override reason"), {
    target: { value: "Changed explicit intent" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Create booking" }).closest("form")!,
  );
  await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
  expect(save.mock.calls[2][1]).not.toBe(save.mock.calls[0][1]);
});
it("does not offer a local overlap override", async () => {
  mock.preview.mockResolvedValue({
    conflicts: [
      {
        id: "one",
        source: "studio",
        summary: "Synthetic local lesson",
        start: "2031-11-03T18:00:00Z",
        end: "2031-11-03T19:00:00Z",
      },
    ],
    externalCalendarChecked: false,
  });
  const save = vi.fn();
  render(
    <ManualBookingDialog
      data={demoSnapshot}
      isDemo={false}
      onClose={vi.fn()}
      onSave={save}
    />,
  );
  fireEvent.submit(
    screen.getByRole("button", { name: "Create booking" }).closest("form")!,
  );
  await screen.findByText(/Local double-booking protection/);
  expect(
    screen.getByRole("button", { name: "Override Google conflict" }),
  ).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
});
it("records past wall time in the studio zone with explicit outcome and financial choices", async () => {
  mock.preview.mockResolvedValue({
    conflicts: [],
    externalCalendarChecked: false,
  });
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <ManualBookingDialog
      data={{
        ...demoSnapshot,
        settings: { ...demoSnapshot.settings, timezone: "America/New_York" },
      }}
      isDemo={false}
      onClose={vi.fn()}
      onSave={save}
    />,
  );
  fireEvent.change(screen.getByLabelText("Entry type"), {
    target: { value: "historical" },
  });
  fireEvent.change(screen.getByLabelText("Starts"), {
    target: { value: "2020-01-01T10:00" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Create booking" }).closest("form")!,
  );
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({
    starts_at: "2020-01-01T15:00:00.000Z",
    timezone: "America/New_York",
    historical: true,
    historical_outcome: "scheduled",
    historical_financial: "record_only",
    attendance_confirmed: false,
  });
  fireEvent.change(screen.getByLabelText("Historical outcome"), {
    target: { value: "completed" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Create booking" }).closest("form")!,
  );
  expect(
    await screen.findByText("Confirm the actual lesson outcome explicitly."),
  ).toBeInTheDocument();
  expect(save).toHaveBeenCalledOnce();
});
it("rejects a DST gap and requires a repeated-hour occurrence", async () => {
  mock.preview.mockResolvedValue({
    conflicts: [],
    externalCalendarChecked: false,
  });
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <ManualBookingDialog
      data={{
        ...demoSnapshot,
        settings: { ...demoSnapshot.settings, timezone: "America/New_York" },
      }}
      isDemo={false}
      onClose={vi.fn()}
      onSave={save}
    />,
  );
  fireEvent.change(screen.getByLabelText("Starts"), {
    target: { value: "2031-03-09T02:30" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Create booking" }).closest("form")!,
  );
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Starts"), {
    target: { value: "2031-11-02T01:30" },
  });
  const repeated = screen.getByLabelText("Repeated hour occurrence");
  fireEvent.submit(
    screen.getByRole("button", { name: "Create booking" }).closest("form")!,
  );
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(repeated, { target: { value: "2031-11-02T06:30:00.000Z" } });
  fireEvent.submit(
    screen.getByRole("button", { name: "Create booking" }).closest("form")!,
  );
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].starts_at).toBe("2031-11-02T06:30:00.000Z");
});
