import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ManualBookingDialog } from "./BookingOverview";
import { demoSnapshot } from "../../data/demo";
const mock = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../../data/bookingCommands", async (original) => ({
  ...(await original<typeof import("../../data/bookingCommands")>()),
  inspectSchedulingConflicts: mock.preview,
}));
afterEach(() => vi.clearAllMocks());
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
