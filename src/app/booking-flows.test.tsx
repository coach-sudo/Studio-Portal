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

describe("interactive booking flows", () => {
  it("creates a demo booking through every public step", async () => {
    const user = userEvent.setup();
    renderApp("/book/private-acting-coaching");
    await user.click(
      await screen.findByRole("button", { name: /google meet/i }),
    );
    await user.click(screen.getByRole("button", { name: /choose a time/i }));
    const slots = await screen.findAllByRole("button", { name: /(?:am|pm)/i });
    await user.click(slots[0]);
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.type(screen.getByLabelText("Student name"), "Jordan Rivera");
    await user.type(
      screen.getByLabelText("Student email"),
      "jordan@example.com",
    );
    await user.click(screen.getByRole("button", { name: /review payment/i }));
    await user.click(screen.getByRole("checkbox", { name: /terms and conditions/i }));
    await user.click(
      screen.getByRole("button", { name: /^confirm booking$/i }),
    );
    expect(
      await screen.findByText("Demo booking confirmed"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Manage booking" }),
    ).toHaveAttribute("href", expect.stringMatching(/^\/booking\/demo-/));
  });

  it("creates and publishes a coach service", async () => {
    const user = userEvent.setup();
    renderApp("/coach/bookings");
    await user.click(await screen.findByRole("button", { name: "Services" }));
    await user.click(screen.getByRole("button", { name: /add service/i }));
    const dialog = screen.getByRole("dialog", { name: "Add service" });
    await user.type(within(dialog).getByLabelText("Name"), "Voice Intensive");
    await user.type(
      within(dialog).getByLabelText("Description"),
      "A focused voice and text session.",
    );
    await user.click(
      within(dialog).getByLabelText(/published in public catalog/i),
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("heading", { name: "Voice Intensive" }),
    ).toBeInTheDocument();
  });

  it("opens a student booking policy and cancels it", async () => {
    const user = userEvent.setup();
    renderApp("/portal/bookings");
    const manage = await screen.findAllByRole("button", { name: "Manage" });
    await user.click(manage[0]);
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel booking" }),
    );
    expect(await screen.findByText(/booking cancelled/i)).toBeInTheDocument();
  });

  it("does not pretend to send a magic link in demo mode", async () => {
    const user = userEvent.setup();
    renderApp("/login");
    await user.type(await screen.findByLabelText(/email/i), "maya@example.com");
    await user.click(screen.getByRole("button", { name: /email me/i }));
    expect(
      await screen.findByText(/demo mode does not send email/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open student portal demo" }),
    ).toHaveAttribute("href", "/portal");
  });

  it("reports missing live integrations truthfully", async () => {
    const user = userEvent.setup();
    renderApp("/coach/settings");
    await user.click(
      await screen.findByRole("button", { name: /Connections/i }),
    );
    expect(
      await screen.findByRole("heading", { name: "Integration health" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("configuration required").length,
    ).toBeGreaterThan(0);
  });

  it("creates a coach booking with an audited override form", async () => {
    const user = userEvent.setup();
    renderApp("/coach/bookings");
    await user.click(
      await screen.findByRole("button", { name: "New booking" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Create a booking" });
    await user.click(
      within(dialog).getByRole("button", { name: "Create booking" }),
    );
    expect(
      await screen.findByText(/booking workspace has been updated/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Maya Kim")).toBeInTheDocument();
  });

  it("creates an editable lesson package product", async () => {
    const user = userEvent.setup();
    renderApp("/coach/finance");
    await user.click(
      await screen.findByRole("button", { name: "Add package" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Add package" });
    await user.type(
      within(dialog).getByLabelText("Name"),
      "Four 60-minute sessions",
    );
    await user.clear(within(dialog).getByLabelText("Package price (USD)"));
    await user.type(
      within(dialog).getByLabelText("Package price (USD)"),
      "190",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save package" }),
    );
    expect(
      await screen.findByText("Package catalog saved."),
    ).toBeInTheDocument();
    expect(screen.getByText("Four 60-minute sessions")).toBeInTheDocument();
  });
});
