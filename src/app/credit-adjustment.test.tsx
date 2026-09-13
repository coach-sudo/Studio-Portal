import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("coach credit adjustments", () => {
  it("accepts a negative lesson-credit correction", async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={["/coach/students/student-maya/payments"]}><App /></MemoryRouter></QueryClientProvider>);
    await user.click(await screen.findByRole("button", { name: "Adjust credits" }));
    const credits = within(await screen.findByRole("dialog")).getByRole("textbox", { name: /Credits/i });
    await user.clear(credits);
    await user.type(credits, "-2");
    expect(credits).toHaveValue("-2");
    await user.click(screen.getByRole("button", { name: "Save credit adjustment" }));
    expect(await screen.findByText(/Removed 2 lesson credits/)).toBeInTheDocument();
  });
  it("saves a 75% public slot visibility preference", async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={["/coach/bookings"]}><App /></MemoryRouter></QueryClientProvider>);
    await user.click(await screen.findByRole("button", { name: "Availability" }));
    const visibility = await screen.findByRole("combobox", { name: /Show this share of open times/i });
    await user.selectOptions(visibility, "75");
    await user.click(screen.getByRole("button", { name: "Save visibility" }));
    expect(await screen.findByText(/Booking page and booking preferences saved/)).toBeInTheDocument();
  });
});
