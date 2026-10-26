import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { LessonBulkList } from "./LessonBulkList";

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (callback: any) => {
        queueMicrotask(() =>
          callback("INITIAL_SESSION", { user: { id: "synthetic-coach" } }),
        );
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));
vi.mock("../data/lessonBulk", () => ({
  readLessonBulkCandidates: vi.fn(async () => ({
    count: 1,
    items: [
      {
        id: "synthetic-lesson",
        topic: "Lesson 0003",
        starts_at: "2027-01-01T12:00:00Z",
        status: "scheduled",
        studentNames: [],
      },
    ],
  })),
  previewLessonBulk: vi.fn(),
}));
vi.mock("./LessonBulkWorkspace", () => ({
  LessonBulkWorkspace: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Batch results">
      <button onClick={onClose}>Close batch</button>
    </div>
  ),
}));
function Location() {
  return <output data-testid="bulk-location">{useLocation().search}</output>;
}

it("changing filters while batch dismissal is pending cannot resurrect the dismissed batch", async () => {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter
        initialEntries={[
          "/coach/bookings?lessonBatch=synthetic-batch&lessonExpected=1&lessonQuery=Lesson+0001",
        ]}
      >
        <LessonBulkList
          studioId="synthetic-studio"
          studentId="synthetic-student"
          timezone="America/New_York"
        />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const search = await screen.findByLabelText("Search lesson titles");
  const close = screen.getByRole("button", { name: "Close batch" });
  // Both interactions can occur before the router commits dismissal. Preserve
  // the new filter without putting the old batch back into the URL.
  act(() => {
    fireEvent.click(close);
    fireEvent.change(search, { target: { value: "Lesson 0003" } });
  });
  expect(screen.queryByRole("dialog") === null).toBe(true);
  const params = new URLSearchParams(
    screen.getByTestId("bulk-location").textContent!,
  );
  expect(params.get("lessonQuery")).toBe("Lesson 0003");
  expect(params.has("lessonBatch")).toBe(false);
  expect(params.has("lessonExpected")).toBe(false);
  await waitFor(() =>
    expect(screen.getByLabelText("Select all visible")).toBeEnabled(),
  );
});
