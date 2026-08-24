import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";
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

describe("30 start-to-finish studio workflows", () => {
  describe("coach — 15 workflows", () => {
    it("01 opens a full student record from the roster", async () => {
      const user = userEvent.setup();
      renderApp("/students");
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
      renderApp("/students");
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
      renderApp("/students");
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
      renderApp("/students");
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
      renderApp("/students/student-liam");
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
      renderApp("/students/student-maya");
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
      renderApp("/students/student-maya");
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
      renderApp("/students/student-liam");
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
      renderApp("/students/student-maya/notes");
      await user.click(
        await screen.findByRole("button", { name: /New note/i }),
      );
      const dialog = screen.getByRole("dialog");
      await user.type(
        within(dialog).getByLabelText("Note"),
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
      renderApp("/students/student-maya/notes");
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
      renderApp("/students/student-sarah/account");
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
      renderApp("/students/student-sarah/actor-page");
      await user.click(
        await screen.findByRole("button", { name: /Create draft/i }),
      );
      expect(
        await screen.findByText("/actors/sarah-patterson"),
      ).toBeInTheDocument();
    });
    it("13 updates studio identity", async () => {
      const user = userEvent.setup();
      renderApp("/settings");
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
      renderApp("/settings");
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
    it("15 updates pricing defaults", async () => {
      const user = userEvent.setup();
      renderApp("/settings");
      await user.click(
        await screen.findByRole("button", { name: /Pricing & reminders/i }),
      );
      const rate = screen.getByLabelText("60-minute lesson");
      await user.clear(rate);
      await user.type(rate, "135");
      await user.click(screen.getByRole("button", { name: "Save defaults" }));
      expect(
        await screen.findByText(/Pricing and reminder defaults saved/i),
      ).toBeInTheDocument();
    });
  });

  describe("current student — 10 workflows", () => {
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
      renderApp("/portal/practice");
      await user.click(await screen.findByRole("button", { name: "Complete" }));
      expect(
        await screen.findByText("Practice marked complete."),
      ).toBeInTheDocument();
    });
    it("20 asks the coach for help", async () => {
      const user = userEvent.setup();
      renderApp("/portal/practice");
      await user.click(
        await screen.findByRole("button", { name: "Ask coach" }),
      );
      expect(
        await screen.findByText(/coach will see the help request/i),
      ).toBeInTheDocument();
    });
    it("21 submits actor material", async () => {
      const user = userEvent.setup();
      renderApp("/portal/materials");
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
  });

  describe("interested student — 5 workflows", () => {
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
      await user.click(screen.getByRole("button", { name: /Review payment/i }));
      await user.click(screen.getByRole("checkbox", { name: /terms and conditions/i }));
      await user.click(
        screen.getByRole("button", { name: /Confirm booking/i }),
      );
      expect(await screen.findByText(/booking confirmed/i)).toBeInTheDocument();
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
  });
});
