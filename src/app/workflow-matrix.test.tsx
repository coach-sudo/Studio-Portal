import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { StudentPortal } from "../features/student/StudentPortal";
import { StudioStoreProvider } from "../state/StudioStore";
const renderApp = (path: string) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
const renderGuardian = (path: string) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <StudioStoreProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/portal/*" element={<StudentPortal role="guardian" />} />
          </Routes>
        </MemoryRouter>
      </StudioStoreProvider>
    </QueryClientProvider>,
  );

describe("50 start-to-finish studio workflows", () => {
  describe("coach — 20 workflows", () => {
    it("01 opens a full student record from the roster", async () => {
      const user = userEvent.setup();
      renderApp("/coach/students");
      await user.click(
        await screen.findByRole("button", { name: /Maya Kim/i }),
      );
      expect(
        await screen.findByRole("heading", { name: "Maya Kim" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Current work" }),
      ).toBeInTheDocument();
    });
    it("02 filters interested students", async () => {
      const user = userEvent.setup();
      renderApp("/coach/students");
      await user.click(
        await screen.findByRole("button", { name: /Interested/i }),
      );
      expect(
        screen.getByRole("button", { name: /Sarah Patterson/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Maya Kim/i }),
      ).not.toBeInTheDocument();
    });
    it("03 adds an adult student", async () => {
      const user = userEvent.setup();
      renderApp("/coach/students");
      await user.click(
        await screen.findByRole("button", { name: /Add student/i }),
      );
      const dialog = screen.getByRole("dialog");
      await user.type(
        within(dialog).getByLabelText("Full name"),
        "Jordan Ellis",
      );
      await user.type(
        within(dialog).getByLabelText("Student email"),
        "jordan@example.com",
      );
      await user.click(
        within(dialog).getByRole("button", { name: /Add student/i }),
      );
      expect(
        await screen.findByRole("button", { name: /Jordan Ellis/i }),
      ).toBeInTheDocument();
    });
    it("04 adds a minor with guardian details", async () => {
      const user = userEvent.setup();
      renderApp("/coach/students");
      await user.click(
        await screen.findByRole("button", { name: /Add student/i }),
      );
      const dialog = screen.getByRole("dialog");
      await user.type(
        within(dialog).getByLabelText("Full name"),
        "Avery Stone",
      );
      await user.click(within(dialog).getByLabelText(/under 18/i));
      await user.type(
        within(dialog).getByLabelText("Guardian name"),
        "Morgan Stone",
      );
      await user.type(
        within(dialog).getByLabelText("Guardian email"),
        "morgan@example.com",
      );
      await user.click(
        within(dialog).getByRole("button", { name: /Add student/i }),
      );
      expect(
        await screen.findByRole("button", { name: /Avery Stone/i }),
      ).toBeInTheDocument();
    });
    it("05 edits student goals and status", async () => {
      const user = userEvent.setup();
      renderApp("/coach/students/student-liam");
      await user.click(
        await screen.findByRole("button", { name: "Edit details" }),
      );
      const dialog = screen.getByRole("dialog");
      await user.selectOptions(
        within(dialog).getByLabelText("Status"),
        "paused",
      );
      await user.clear(within(dialog).getByLabelText("Goals"));
      await user.type(
        within(dialog).getByLabelText("Goals"),
        "Prepare a fall showcase.",
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Save details" }),
      );
      expect(
        await screen.findByText("Student details saved."),
      ).toBeInTheDocument();
      expect(screen.getByText("paused")).toBeInTheDocument();
    });
    it("06 schedules a lesson from the student record", async () => {
      const user = userEvent.setup();
      renderApp("/coach/students/student-maya");
      await user.click(
        await screen.findByRole("button", { name: /Add lesson/i }),
      );
      const dialog = screen.getByRole("dialog");
      await user.clear(within(dialog).getByLabelText("Lesson focus"));
      await user.type(
        within(dialog).getByLabelText("Lesson focus"),
        "Callback prep",
      );
      await user.type(
        within(dialog).getByLabelText("Start"),
        "2026-09-10T15:00",
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Add lesson" }),
      );
      expect(
        await screen.findByText("Lesson added to the schedule."),
      ).toBeInTheDocument();
    });
    it("07 assigns practice", async () => {
      const user = userEvent.setup();
      renderApp("/coach/students/student-maya");
      await user.click(
        await screen.findByRole("button", { name: /Assign practice/i }),
      );
      const dialog = screen.getByRole("dialog");
      await user.type(
        within(dialog).getByLabelText("Title"),
        "Two contrasting takes",
      );
      await user.type(
        within(dialog).getByLabelText("Instructions"),
        "Upload both versions.",
      );
      await user.click(within(dialog).getByRole("button", { name: "Assign" }));
      expect(await screen.findByText(/Practice assigned/i)).toBeInTheDocument();
    });
    it("08 adds current material", async () => {
      const user = userEvent.setup();
      renderApp("/coach/students/student-liam");
      await user.click(
        await screen.findByRole("button", { name: /Add material/i }),
      );
      const dialog = screen.getByRole("dialog");
      await user.type(within(dialog).getByLabelText("Title"), "Hamlet sides");
      await user.click(
        within(dialog).getByRole("button", { name: "Add material" }),
      );
      expect(
        await screen.findByText("Material added to the student record."),
      ).toBeInTheDocument();
    });
    it("09 saves a private coach note", async () => {
      const user = userEvent.setup();
      renderApp("/coach/students/student-maya/notes");
      await user.click(
        await screen.findByRole("button", { name: /New note/i }),
      );
      const dialog = screen.getByRole("dialog");
      await user.type(
        within(dialog).getByLabelText("Note"),
        "Private coaching observation.",
      );
      expect(within(dialog).getByLabelText("Note")).toHaveTextContent(
        "Private coaching observation.",
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Save note" }),
      );
      expect(
        await screen.findByText("Private draft saved."),
      ).toBeInTheDocument();
    });
    it("10 publishes a student note", async () => {
      const user = userEvent.setup();
      renderApp("/coach/students/student-maya/notes");
      await user.click(
        await screen.findByRole("button", { name: /New note/i }),
      );
      const dialog = screen.getByRole("dialog");
      await user.type(
        within(dialog).getByLabelText("Note"),
        "Great work today.",
      );
      await user.click(within(dialog).getByLabelText(/Publish to student/i));
      await user.click(
        within(dialog).getByRole("button", { name: "Save note" }),
      );
      expect(
        await screen.findByText("Note published to the student."),
      ).toBeInTheDocument();
    });
    it("11 changes portal access", async () => {
      const user = userEvent.setup();
      renderApp("/coach/students/student-sarah/account");
      const toggle = await screen.findByRole("switch", {
        name: /Student workspace/i,
      });
      expect(toggle).toHaveAttribute("aria-checked", "false");
      await user.click(toggle);
      expect(
        await screen.findByText("Student details saved."),
      ).toBeInTheDocument();
      expect(toggle).toHaveAttribute("aria-checked", "true");
    });
    it("12 creates an actor-page draft", async () => {
      const user = userEvent.setup();
      renderApp("/coach/students/student-sarah/actor-page");
      await user.click(
        await screen.findByRole("button", { name: /Create draft/i }),
      );
      expect(
        await screen.findByText("/actors/sarah-patterson"),
      ).toBeInTheDocument();
    });
    it("13 updates studio identity", async () => {
      const user = userEvent.setup();
      renderApp("/coach/settings");
      const input = await screen.findByLabelText("Studio name");
      await user.clear(input);
      await user.type(input, "New Studio Name");
      await user.click(screen.getByRole("button", { name: "Save studio" }));
      expect(
        await screen.findByText(/identity and contact details saved/i),
      ).toBeInTheDocument();
      expect(screen.getByText("New Studio Name")).toBeInTheDocument();
    });
    it("14 updates student workspace visibility", async () => {
      const user = userEvent.setup();
      renderApp("/coach/settings");
      await user.click(
        await screen.findByRole("button", { name: /Student workspace/i }),
      );
      const toggle = screen.getByRole("switch", { name: /Drive folder/i });
      await user.click(toggle);
      await user.click(screen.getByRole("button", { name: "Save workspace" }));
      expect(
        await screen.findByText(/workspace preferences saved/i),
      ).toBeInTheDocument();
    });
    it("15 updates lesson rates", async () => {
      const user = userEvent.setup();
      renderApp("/coach/settings");
      await user.click(
        await screen.findByRole("button", { name: /Rates & reminders/i }),
      );
      const rate = screen.getByLabelText("60-minute lesson");
      await user.clear(rate);
      await user.type(rate, "135");
      await user.click(
        screen.getByRole("button", { name: "Save rates and reminders" }),
      );
      expect(
        await screen.findByText(/Lesson rates and reminder timing saved/i),
      ).toBeInTheDocument();
    });
    it("16 keeps Home oriented around the week and one Today action", async () => {
      renderApp("/coach");
      expect((await screen.findAllByText("Open Today")).length).toBeGreaterThan(0);
      expect(screen.getByText("Coming up this week")).toBeInTheDocument();
      expect(screen.queryByText("Run today")).not.toBeInTheDocument();
    });
    it("17 keeps Today as the preparation and action queue", async () => {
      renderApp("/coach/today");
      expect(await screen.findByText("Today’s lessons")).toBeInTheDocument();
      expect(screen.getAllByLabelText(/Preparation for/i).length).toBeGreaterThan(0);
      expect(screen.getByText("Notes due within 48 hours")).toBeInTheDocument();
    });
    it("18 opens Bookings on the calendar", async () => {
      renderApp("/coach/bookings");
      const calendar = await screen.findByRole("button", { name: "Calendar" });
      expect(calendar).toHaveClass("active");
      expect(screen.getByRole("button", { name: "Overview" })).not.toHaveClass("active");
    });
    it("19 filters the material index by its role", async () => {
      const user = userEvent.setup();
      renderApp("/coach/materials");
      const scripts = await screen.findByRole("button", { name: /Current scripts/i });
      await user.click(scripts);
      expect(scripts).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: /Actor-page media/i })).toBeInTheDocument();
    });
    it("20 explains booking limits in plain language", async () => {
      const user = userEvent.setup();
      renderApp("/coach/bookings");
      await user.click(await screen.findByRole("button", { name: "Booking setup" }));
      expect(screen.getByLabelText("How far ahead people can book (days)")).toBeInTheDocument();
      expect(screen.queryByText(/^Booking horizon$/i)).not.toBeInTheDocument();
    });
  });

  describe("current student — 15 workflows", () => {
    it("16 sees next work, lesson, and contact actions", async () => {
      renderApp("/portal");
      expect(
        await screen.findByRole("heading", { name: /Welcome back/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /Book a lesson/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /Email coach/i }),
      ).toBeInTheDocument();
    });
    it("17 opens current work", async () => {
      renderApp("/portal/work");
      expect(
        await screen.findByRole("heading", { name: "Current Work" }),
      ).toBeInTheDocument();
      expect(screen.getByText("The Seagull — Nina")).toBeInTheDocument();
    });
    it("18 keeps current work focused on assigned studio work", async () => {
      renderApp("/portal/work");
      expect(await screen.findByRole("heading", { name: "Current Work" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Request a reader/i })).not.toBeInTheDocument();
    });
    it("19 completes practice", async () => {
      const user = userEvent.setup();
      renderApp("/portal/work");
      await user.click(await screen.findByRole("button", { name: "Complete & archive" }));
      expect(
        await screen.findByText("Practice marked complete."),
      ).toBeInTheDocument();
    });
    it("20 asks the coach for help", async () => {
      const user = userEvent.setup();
      renderApp("/portal/work");
      await user.click(
        await screen.findByRole("button", { name: "Ask coach" }),
      );
      expect(
        await screen.findByText(/coach will see the help request/i),
      ).toBeInTheDocument();
    });
    it("21 submits actor material", async () => {
      const user = userEvent.setup();
      renderApp("/portal/actor-page");
      await user.click(
        await screen.findByRole("button", { name: "Submit material" }),
      );
      const dialog = screen.getByRole("dialog");
      await user.type(within(dialog).getByLabelText("Title"), "New reel");
      await user.type(
        within(dialog).getByLabelText("Share link"),
        "https://example.com/reel",
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Submit for review" }),
      );
      expect(
        await screen.findByText(/submitted to your coach/i),
      ).toBeInTheDocument();
    });
    it("22 edits and submits an actor page", async () => {
      const user = userEvent.setup();
      renderApp("/portal/actor-page");
      await user.click(await screen.findByRole("button", { name: "Edit" }));
      const dialog = screen.getByRole("dialog");
      await user.clear(within(dialog).getByLabelText("Bio"));
      await user.type(
        within(dialog).getByLabelText("Bio"),
        "New actor biography.",
      );
      await user.click(
        within(dialog).getByLabelText(/Submit for coach review/i),
      );
      await user.click(within(dialog).getByRole("button", { name: "Save" }));
      expect(
        await screen.findByText(/submitted for coach review/i),
      ).toBeInTheDocument();
    });
    it("23 reschedules a booking", async () => {
      const user = userEvent.setup();
      renderApp("/portal/bookings");
      await user.click(
        await screen.findByRole("button", { name: "Reschedule" }),
      );
      const dialog = screen.getByRole("dialog");
      const slots = within(dialog).getAllByRole("button", {
        name: /(?:am|pm)/i,
      });
      await user.click(slots[0]);
      await user.click(
        within(dialog).getByRole("button", { name: /Confirm new time/i }),
      );
      expect(await screen.findByText(/rescheduled/i)).toBeInTheDocument();
    });
    it("24 cancels a booking with policy visibility", async () => {
      const user = userEvent.setup();
      renderApp("/portal/bookings");
      await user.click(
        (await screen.findAllByRole("button", { name: "Manage" }))[0],
      );
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(/Accepted policy/i)).toBeInTheDocument();
      await user.click(
        within(dialog).getByRole("button", { name: "Cancel booking" }),
      );
      expect(await screen.findByText(/Booking cancelled/i)).toBeInTheDocument();
    });
    it("25 reviews packages, receipts, and balance", async () => {
      renderApp("/portal/payments");
      expect(
        await screen.findByRole("heading", { name: "Payments" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Packages" }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Current balance/i)).toBeInTheDocument();
    });
    it("26 sees only the three immediate priorities on Home", async () => {
      renderApp("/portal");
      expect(await screen.findByRole("heading", { name: "Next lesson" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Current work" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Next practice" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Materials" })).not.toBeInTheDocument();
    });
    it("27 opens a lesson as one connected workspace", async () => {
      const user = userEvent.setup();
      renderApp("/portal/bookings");
      await user.click((await screen.findAllByRole("link", { name: "Details" }))[0]);
      expect(await screen.findByText("Lesson work")).toBeInTheDocument();
      expect(screen.getByText("Administrative details")).toBeInTheDocument();
    });
    it("28 browses published notes by lesson", async () => {
      renderApp("/portal/notes");
      expect(await screen.findByRole("heading", { name: "Notes" })).toBeInTheDocument();
      expect(screen.getByText("Lesson notes")).toBeInTheDocument();
      expect(screen.getByLabelText("Search notes")).toBeInTheDocument();
    });
    it("29 updates portal timezone without losing the form", async () => {
      const user = userEvent.setup();
      renderApp("/portal/settings");
      await screen.findByRole("heading", { name: "Settings" });
      await user.selectOptions(screen.getByLabelText("Timezone"), "Europe/London");
      await user.click(screen.getByRole("button", { name: /Save settings/i }));
      expect(await screen.findByText(/settings.*saved/i)).toBeInTheDocument();
    });
    it("30 keeps completed practice out of the active queue", async () => {
      const user = userEvent.setup();
      renderApp("/portal/work");
      await user.click(await screen.findByRole("button", { name: "Complete & archive" }));
      expect(await screen.findByText("Practice marked complete.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Show completed work/i })).toBeInTheDocument();
    });
  });

  describe("public and interested student — 10 workflows", () => {
    it("26 browses the service catalog", async () => {
      renderApp("/book");
      expect(
        await screen.findByRole("heading", { name: /Find the right room/i }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole("link", { name: /View times/i }).length,
      ).toBeGreaterThan(2);
    });
    it("27 selects delivery and reaches availability", async () => {
      const user = userEvent.setup();
      renderApp("/book/private-acting-coaching");
      await user.click(
        await screen.findByRole("button", { name: /Google Meet/i }),
      );
      await user.click(screen.getByRole("button", { name: /Choose a time/i }));
      expect(
        (await screen.findAllByRole("button", { name: /(?:am|pm)/i })).length,
      ).toBeGreaterThan(0);
    });
    it("28 completes an adult booking", async () => {
      const user = userEvent.setup();
      renderApp("/book/audition-tune-up");
      await user.click(
        await screen.findByRole("button", { name: /Google Meet/i }),
      );
      await user.click(screen.getByRole("button", { name: /Choose a time/i }));
      await user.click(
        (await screen.findAllByRole("button", { name: /(?:am|pm)/i }))[0],
      );
      await user.click(screen.getByRole("button", { name: /Continue/i }));
      await user.type(screen.getByLabelText("Student name"), "Taylor Reed");
      await user.type(
        screen.getByLabelText("Student email"),
        "taylor@example.com",
      );
      await user.click(
        screen.getByRole("checkbox", { name: /create a studio portal profile/i }),
      );
      await user.click(screen.getByRole("button", { name: /Review payment/i }));
      await user.click(screen.getByRole("checkbox", { name: /terms and conditions/i }));
      await user.click(
        screen.getByRole("button", { name: /Confirm booking/i }),
      );
      expect(await screen.findByText(/booking confirmed/i)).toBeInTheDocument();
      expect(
        screen.getByText(/portal invitation is being prepared separately/i),
      ).toBeInTheDocument();
    });
    it("29 completes guardian contact details for a minor", async () => {
      const user = userEvent.setup();
      renderApp("/book/private-acting-coaching");
      await user.click(
        await screen.findByRole("button", { name: /In person/i }),
      );
      await user.click(screen.getByRole("button", { name: /Choose a time/i }));
      await user.click(
        (await screen.findAllByRole("button", { name: /(?:am|pm)/i }))[0],
      );
      await user.click(screen.getByRole("button", { name: /Continue/i }));
      await user.click(
        screen.getByRole("checkbox", { name: /student under 18/i }),
      );
      expect(screen.getByLabelText("Guardian name")).toBeInTheDocument();
      expect(screen.getByLabelText("Guardian email")).toBeInTheDocument();
    });
    it("30 manages one secure guest booking", async () => {
      const user = userEvent.setup();
      renderApp("/booking/demo-maya");
      expect(
        await screen.findByRole("heading", { name: "Private Acting Coaching" }),
      ).toBeInTheDocument();
      expect(document.body).toHaveTextContent("SS-1048");
      await user.click(screen.getByRole("button", { name: "Cancel booking" }));
      await user.click(
        screen.getByRole("button", { name: "Confirm cancellation" }),
      );
      expect(await screen.findByText(/Booking cancelled/i)).toBeInTheDocument();
    });
    it("31 shows one clear shared sign-in destination", async () => {
      renderApp("/login");
      expect(await screen.findByRole("heading", { name: /Sign in to/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeInTheDocument();
      expect(screen.getByLabelText("Username")).toBeInTheDocument();
    });
    it("32 shows service price, delivery, and policy before availability", async () => {
      renderApp("/book/private-acting-coaching");
      expect(await screen.findByRole("heading", { name: "Private Acting Coaching" })).toBeInTheDocument();
      expect(screen.getByText(/self-service reschedule/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Choose a time/i })).toBeInTheDocument();
    });
    it("33 presents availability as a calendar before time choices", async () => {
      const user = userEvent.setup();
      renderApp("/book/audition-tune-up");
      await user.click(await screen.findByRole("button", { name: /Google Meet/i }));
      await user.click(screen.getByRole("button", { name: /Choose a time/i }));
      expect(await screen.findByLabelText("Available dates")).toBeInTheDocument();
    });
    it("34 exposes terms from a stable public route", async () => {
      renderApp("/terms");
      expect(await screen.findByRole("heading", { name: /Terms and Conditions/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Return to booking/i })).toHaveAttribute("href", "/book");
    });
    it("35 preserves the legacy student URL by redirecting to the portal", async () => {
      renderApp("/student/work");
      expect(await screen.findByRole("heading", { name: "Current Work" })).toBeInTheDocument();
      expect(screen.getByText("The Seagull — Nina")).toBeInTheDocument();
    });
  });

  describe("guardian — 5 role-specific workflows", () => {
    it("G1 opens the linked student overview", async () => {
      renderGuardian("/portal");
      expect(await screen.findByText(/Guardian for/i)).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Next lesson" })).toBeInTheDocument();
    });
    it("G2 opens the linked student schedule", async () => {
      renderGuardian("/portal/bookings");
      expect(await screen.findByRole("heading", { name: "Schedule" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Upcoming" })).toBeInTheDocument();
    });
    it("G3 can access guardian-only payment information", async () => {
      renderGuardian("/portal/payments");
      expect(await screen.findByRole("heading", { name: "Payments" })).toBeInTheDocument();
      expect(screen.getByText(/Current balance/i)).toBeInTheDocument();
    });
    it("G4 can open the linked actor-page workspace", async () => {
      renderGuardian("/portal/actor-page");
      expect(
        (await screen.findAllByRole("heading", { name: "Actor Page" })).length,
      ).toBeGreaterThan(0);
    });
    it("G5 can manage contact, timezone, and billing settings", async () => {
      renderGuardian("/portal/settings");
      expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
      expect(screen.getByLabelText("Timezone")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Payment method" })).toBeInTheDocument();
    });
  });
});
