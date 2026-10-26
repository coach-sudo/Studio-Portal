import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { BookingCenter } from "../features/coach/BookingCenter";
import { StudioStoreProvider, useStudioStore } from "../state/StudioStore";
type FixtureMutation = Parameters<
  ReturnType<typeof useStudioStore>["transact"]
>[0];

const liveSnapshots = vi.hoisted(() => ({ fresh: false, deferOpen: false }));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useSearchParams: (...args: Parameters<typeof actual.useSearchParams>) => {
      const result = actual.useSearchParams(...args);
      if (!liveSnapshots.deferOpen) return result;
      const [params, setParams] = result;
      const update: typeof setParams = (next, options) => {
        const value = typeof next === "function" ? next(params) : next;
        const opening =
          new URLSearchParams(value).has("lesson") && !params.has("lesson");
        if (opening) setTimeout(() => setParams(value, options), 40);
        else setParams(value, options);
      };
      return [params, update] as ReturnType<typeof actual.useSearchParams>;
    },
  };
});
vi.mock("../hooks/useStudio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useStudio")>();
  return {
    ...actual,
    useStudioRoute: (...args: Parameters<typeof actual.useStudioRoute>) => {
      const result = actual.useStudioRoute(...args);
      return {
        ...result,
        data:
          result.data && liveSnapshots.fresh ? { ...result.data } : result.data,
      };
    },
  };
});
afterEach(() => {
  liveSnapshots.fresh = false;
  liveSnapshots.deferOpen = false;
});

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}
function FixtureSeed({ seed }: { seed: FixtureMutation }) {
  const { transact } = useStudioStore();
  useEffect(() => {
    transact(seed);
  }, [seed, transact]);
  return null;
}
function renderBookings(path = "/coach/bookings", seed?: FixtureMutation) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        {seed ? (
          <StudioStoreProvider>
            <FixtureSeed seed={seed} />
            <BookingCenter />
          </StudioStoreProvider>
        ) : (
          <App />
        )}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("calendar appointment details", () => {
  it("retains the opener while a fresh snapshot arrives before the appointment URL commits", async () => {
    liveSnapshots.fresh = true;
    liveSnapshots.deferOpen = true;
    const user = userEvent.setup();
    renderBookings();
    fireEvent.change(await screen.findByLabelText("Search lessons"), {
      target: { value: "Scene Study" },
    });
    const opener = document.querySelector<HTMLButtonElement>(
      '.calendar-search-results [data-calendar-lesson="lesson-maya-next"]',
    )!;
    opener.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "SS-1048" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement === opener).toBe(true);
  });

  it.each([false, true])(
    "restores the unfocused search-result opener with fresh snapshots=%s",
    async (fresh) => {
      liveSnapshots.fresh = fresh;
      const user = userEvent.setup();
      renderBookings();
      const search = await screen.findByLabelText("Search lessons");
      fireEvent.change(search, { target: { value: "Maya Kim" } });
      const appointment = document.querySelector<HTMLButtonElement>(
        ".calendar-search-results button",
      )!;
      // Touch activation and a replaced focused node need not leave the button as
      // document.activeElement. The click's currentTarget remains authoritative.
      search.blur();
      fireEvent.click(appointment);
      await screen.findByRole("dialog");
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement === appointment).toBe(true);
    },
  );

  it.each(["booking=booking-maya", "lesson=lesson-maya-next"])(
    "dismisses %s when live query snapshots change identity on every render",
    async (query) => {
      liveSnapshots.fresh = true;
      const user = userEvent.setup();
      renderBookings(`/coach/bookings?${query}`);
      const drawer = await screen.findByRole("dialog", { name: "SS-1048" });
      await user.click(within(drawer).getByRole("button", { name: "Done" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByTestId("location").textContent).toBe(
        "/coach/bookings",
      );
    },
  );
  it("keeps the selected recurring occurrence rather than the first booked lesson", async () => {
    renderBookings("/coach/bookings?lesson=second-occurrence", (draft) => {
      const first = draft.lessons.find(
        (lesson) => lesson.id === "lesson-maya-next",
      )!;
      draft.lessons.push({
        ...first,
        id: "second-occurrence",
        startsAt: "2026-10-20T14:00:00.000Z",
        endsAt: "2026-10-20T15:00:00.000Z",
      });
      draft.lessonParticipants.push({
        ...draft.lessonParticipants.find(
          (participant) => participant.bookingId === "booking-maya",
        )!,
        id: "second-participant",
        lessonId: "second-occurrence",
      });
    });
    const drawer = within(
      await screen.findByRole("dialog", { name: "SS-1048" }),
    );
    expect(
      drawer.getByText(/Oct 20, 2026, 10:00 AM.*11:00 AM/),
    ).toBeInTheDocument();
    expect(
      drawer.getAllByRole("link", { name: "Open lesson" })[0],
    ).toHaveAttribute(
      "href",
      "/coach/students/student-maya/lessons/second-occurrence",
    );
  });

  it("offers group participants explicitly and returns focus to the calendar after inspecting one", async () => {
    const user = userEvent.setup();
    renderBookings("/coach/bookings", (draft) => {
      const lesson = draft.lessons.find(
        (item) => item.id === "lesson-scene-night",
      )!;
      const booking = draft.bookings.find(
        (item) => item.id === "booking-maya",
      )!;
      // The demo group is two weeks ahead and may fall outside the initially
      // visible month. Keep this interaction fixture in the visible lesson range.
      lesson.startsAt = draft.lessons.find(
        (item) => item.id === "lesson-maya-next",
      )!.startsAt;
      lesson.endsAt = new Date(
        Date.parse(lesson.startsAt) + 2 * 3_600_000,
      ).toISOString();
      draft.lessonParticipants.push({
        id: "group-maya",
        lessonId: lesson.id,
        bookingId: booking.id,
        studentId: booking.studentId,
        displayName: booking.guestName,
        email: booking.guestEmail,
        status: "confirmed",
      });
    });
    await screen.findByLabelText("Search lessons");
    const appointment = screen
      .getAllByRole("button", { name: /August Scene Night/ })
      .find((button) => button.classList.contains("calendar-event"))!;
    appointment.focus();
    await user.keyboard("{Enter}");
    const group = within(
      screen.getByRole("dialog", { name: "August Scene Night" }),
    );
    expect(group.getAllByRole("button", { name: "View booking" })).toHaveLength(
      2,
    );
    const participant = group.getByText("Maya Kim").closest("article")!;
    await user.click(
      within(participant).getByRole("button", { name: "View booking" }),
    );
    const drawer = await screen.findByRole("dialog", { name: "SS-1048" });
    expect(
      within(drawer).getByRole("link", { name: "Open lesson" }),
    ).toHaveAttribute(
      "href",
      "/coach/students/student-maya/lessons/lesson-scene-night",
    );
    await user.keyboard("{Escape}");
    expect(appointment).toHaveFocus();
  });

  it("opens a related booking in context with keyboard selection and restores focus", async () => {
    const user = userEvent.setup();
    renderBookings();
    await screen.findByLabelText("Search lessons");
    const appointment = screen
      .getAllByRole("button", { name: /Maya Kim.*Scene Study/ })
      .find((button) => button.classList.contains("calendar-event"))!;
    appointment.focus();
    await user.keyboard("{Enter}");
    const drawer = within(screen.getByRole("dialog", { name: "SS-1048" }));
    expect(screen.getByRole("dialog")).toHaveClass("workflow-drawer");
    expect(
      screen.getByRole("heading", { name: "Lesson calendar" }),
    ).toBeInTheDocument();
    expect(drawer.getByText(/\$125.00 paid of \$125.00/)).toBeInTheDocument();
    expect(drawer.getByRole("link", { name: "Open student" })).toHaveAttribute(
      "href",
      "/coach/students/student-maya",
    );
    expect(
      drawer.getAllByRole("link", { name: "Open lesson" })[0],
    ).toHaveAttribute(
      "href",
      "/coach/students/student-maya/lessons/lesson-maya-next",
    );
    expect(drawer.getByRole("link", { name: "Message" })).toHaveAttribute(
      "href",
      "/coach/inbox?student=student-maya",
    );
    expect(
      drawer.getByRole("button", { name: "Confirm location" }),
    ).toBeInTheDocument();
    expect(drawer.getByRole("button", { name: "Refund" })).toBeInTheDocument();
    for (let i = 0; i < 30; i++) {
      await user.tab({ shift: i % 2 === 0 });
      expect(screen.getByRole("dialog")).toContainElement(
        document.activeElement as HTMLElement,
      );
    }
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(appointment).toHaveFocus();
    expect(screen.getByTestId("location")).toHaveTextContent("/coach/bookings");
  });

  it.each(["booking=booking-maya", "lesson=lesson-maya-next"])(
    "preserves the %s deep link and clears it on Done",
    async (query) => {
      const user = userEvent.setup();
      renderBookings(`/coach/bookings?${query}`);
      const drawer = await screen.findByRole("dialog", { name: "SS-1048" });
      await user.click(within(drawer).getByRole("button", { name: "Done" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByTestId("location").textContent).toBe(
        "/coach/bookings",
      );
    },
  );

  it("shows an unbooked lesson without fabricating booking or refund/cancel actions", async () => {
    renderBookings("/coach/bookings?lesson=lesson-liam-next");
    const drawer = within(
      await screen.findByRole("dialog", { name: "Scene Study" }),
    );
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "Liam Foster",
    );
    expect(drawer.getByText("Studio A")).toBeInTheDocument();
    expect(
      drawer.queryByRole("button", { name: "Refund" }),
    ).not.toBeInTheDocument();
    expect(
      drawer.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
    expect(
      drawer.getAllByRole("link", { name: "Open lesson" })[0],
    ).toHaveAttribute(
      "href",
      "/coach/students/student-liam/lessons/lesson-liam-next",
    );
    expect(
      screen.getByRole("heading", { name: "Lesson calendar" }),
    ).toBeInTheDocument();
  });
});
