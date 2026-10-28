import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { CalendarDiscovery } from "./CalendarDiscovery";
const f = vi.hoisted(() => ({
  list: vi.fn(),
  start: vi.fn(),
  page: vi.fn(),
  progress: vi.fn(),
  saved: vi.fn(),
}));
vi.mock("../../data/calendarDiscovery", () => ({
  listAccessibleCalendars: f.list,
  startCalendarDiscovery: f.start,
  continueCalendarDiscovery: f.page,
  loadDiscoveryProgress: f.progress,
  listSavedDiscoveries: f.saved,
}));
const scan = "e8000000-0000-4000-8000-000000000001",
  calendar = {
    id: "alpha",
    label: "Studio Calendar",
    timezone: "UTC",
    accessRole: "owner",
    primary: true,
    selectable: true,
  };
const progress = (status = "queued", page = 0) => ({
  scanId: scan,
  from: "2020-01-01T14:00:00Z",
  to: "2020-02-01T14:00:00Z",
  timezone: "America/New_York",
  status,
  total: 0,
  hasMore: false,
  nextCursor: null,
  items: [],
  sources: [
    {
      calendarId: "alpha",
      label: "Studio Calendar",
      calendarTimezone: "UTC",
      status,
      pageSequence: page,
      observed: 0,
      attempts: page,
      lastAttemptAt: null,
      lastSuccessAt: null,
      failureCode: null,
    },
  ],
});
beforeEach(() => {
  vi.resetAllMocks();
  f.list.mockResolvedValue({
    items: [calendar],
    hasMore: false,
    nextCursor: null,
  });
  f.start.mockResolvedValue({
    scanId: scan,
    accepted: true,
    statusAtAcceptance: "queued",
  });
  f.progress.mockResolvedValue(progress());
});
it("keeps a revoked calendar selection visible for explicit removal and blocks an incomplete request", async () => {
  mount();
  await prepare();
  f.list.mockResolvedValue({
    items: [{ ...calendar, selectable: false }],
    hasMore: false,
    nextCursor: null,
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Load accessible calendars",
      exact: true,
    }),
  );
  await screen.findByText(/event read access unavailable/);
  const selected = screen.getByRole("checkbox", { name: /Studio Calendar/ });
  expect(selected).toBeChecked();
  expect(selected).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save preview request" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "permission is unavailable",
  );
  expect(f.start).not.toHaveBeenCalled();
  fireEvent.click(selected);
  expect(
    screen.getByRole("button", { name: "Save preview request" }),
  ).toBeDisabled();
});
it("requires a repeated-hour occurrence choice and submits the selected instant", async () => {
  mount();
  await prepare();
  fireEvent.change(screen.getByLabelText("From", { exact: true }), {
    target: { value: "2031-11-02T01:30" },
  });
  fireEvent.change(screen.getByLabelText("Until", { exact: true }), {
    target: { value: "2031-11-02T03:30" },
  });
  fireEvent.change(screen.getByLabelText("From repeated-hour occurrence"), {
    target: { value: "2031-11-02T06:30:00.000Z" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save preview request" }));
  await screen.findByRole("heading", { name: "Preview queued" });
  expect(f.start.mock.calls[0][0].from).toBe("2031-11-02T06:30:00.000Z");
});
const mount = (timezone = "America/New_York") =>
  render(
    <MemoryRouter>
      <CalendarDiscovery timezone={timezone} />
    </MemoryRouter>,
  );
async function prepare() {
  fireEvent.click(
    screen.getByRole("button", {
      name: "Calendar discovery previews",
      exact: true,
    }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Load accessible calendars",
      exact: true,
    }),
  );
  await screen.findByRole("checkbox", { name: /Studio Calendar/ });
  fireEvent.click(screen.getByRole("checkbox", { name: /Studio Calendar/ }));
  fireEvent.change(screen.getByLabelText("From", { exact: true }), {
    target: { value: "2020-01-01T09:00" },
  });
  fireEvent.change(screen.getByLabelText("Until", { exact: true }), {
    target: { value: "2020-02-01T09:00" },
  });
}
it("reads no provider on mount, preserves a lost start request and uses explicit historical studio times", async () => {
  mount();
  expect(f.list).not.toHaveBeenCalled();
  expect(f.page).not.toHaveBeenCalled();
  await prepare();
  f.start.mockRejectedValueOnce(new Error("Synthetic lost start response"));
  fireEvent.click(screen.getByRole("button", { name: "Save preview request" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("From", { exact: true })).toHaveValue(
    "2020-01-01T09:00",
  );
  expect(
    screen.getByRole("checkbox", { name: /Studio Calendar/ }),
  ).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Save preview request" }));
  await screen.findByRole("heading", { name: "Preview queued" });
  expect(f.start.mock.calls[0]).toEqual(f.start.mock.calls[1]);
  expect(f.start.mock.calls[0][0]).toMatchObject({
    from: "2020-01-01T14:00:00.000Z",
    timezone: "America/New_York",
  });
  expect(f.page).not.toHaveBeenCalled();
});
it("retains the same page identity when a lost response is followed by advanced saved progress", async () => {
  mount();
  await prepare();
  fireEvent.click(screen.getByRole("button", { name: "Save preview request" }));
  await screen.findByRole("heading", { name: "Preview queued" });
  f.progress.mockResolvedValue(progress("completed", 1));
  f.page
    .mockRejectedValueOnce(new Error("Synthetic checkpoint response lost"))
    .mockResolvedValueOnce({ checkpointCommitted: true });
  fireEvent.click(
    screen.getByRole("button", { name: "Studio Calendar: read next page" }),
  );
  await screen.findByRole("alert");
  await screen.findByRole("heading", { name: "Preview completed" });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Studio Calendar: recover previous page result",
    }),
  );
  await waitFor(() => expect(f.page).toHaveBeenCalledTimes(2));
  expect(f.page.mock.calls[0]).toEqual(f.page.mock.calls[1]);
  expect(f.page.mock.calls[1][0].pageSequence).toBe(0);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: /recover previous page result/ }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getByText("No events were returned in this selected range."),
  ).toBeInTheDocument();
});
it("keeps a later-page calendar selected while the first page is refreshed", async () => {
  f.list
    .mockResolvedValueOnce({
      items: [calendar],
      hasMore: true,
      nextCursor: "second",
    })
    .mockResolvedValueOnce({
      items: [{ ...calendar, id: "beta", label: "Historical Calendar" }],
      hasMore: false,
      nextCursor: null,
    })
    .mockResolvedValueOnce({
      items: [calendar],
      hasMore: true,
      nextCursor: "second",
    });
  mount();
  await prepare();
  fireEvent.click(screen.getByRole("button", { name: "Load more calendars" }));
  await screen.findByRole("checkbox", { name: /Historical Calendar/ });
  fireEvent.click(
    screen.getByRole("checkbox", { name: /Historical Calendar/ }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Load accessible calendars",
      exact: true,
    }),
  );
  await waitFor(() => expect(f.list).toHaveBeenCalledTimes(3));
  expect(
    screen.getByRole("checkbox", { name: /Historical Calendar/ }),
  ).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Save preview request" }));
  await screen.findByRole("heading", { name: "Preview queued" });
  expect(
    f.start.mock.calls[0][0].calendars.map((c: { id: string }) => c.id),
  ).toEqual(["alpha", "beta"]);
});
it("rejects a DST gap without a provider write and identifies missing timezone policy", async () => {
  const { unmount } = mount();
  await prepare();
  fireEvent.change(screen.getByLabelText("From", { exact: true }), {
    target: { value: "2026-03-08T02:30" },
  });
  fireEvent.change(screen.getByLabelText("Until", { exact: true }), {
    target: { value: "2026-03-09T03:30" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save preview request" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent("DST gap");
  expect(f.start).not.toHaveBeenCalled();
  unmount();
  mount("");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Calendar discovery previews",
      exact: true,
    }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("valid studio timezone");
  expect(
    screen.getByRole("button", { name: "Save preview request" }),
  ).toBeDisabled();
});
