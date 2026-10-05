import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { BookingCenter } from "../features/coach/BookingCenter";
import { StudioStoreProvider, useStudioStore } from "../state/StudioStore";
type FixtureMutation = Parameters<
  ReturnType<typeof useStudioStore>["transact"]
>[0];

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
