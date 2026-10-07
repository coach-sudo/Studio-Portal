import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("coach credit adjustments", () => {
  it("sets a remaining total with a required reason instead of a signed correction", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter
          initialEntries={["/coach/students/student-maya/payments"]}
        >
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Set remaining credits" },
        { timeout: 10000 },
      ),
    );
    const dialog = within(await screen.findByRole("dialog"));
    const credits = dialog.getByRole("spinbutton", {
      name: /New remaining total/i,
    });
    await user.clear(credits);
    await user.type(credits, "4");
    expect(credits).toHaveValue(4);
    expect(dialog.getByRole("button", { name: "Save total" })).toBeDisabled();
    await user.type(
      dialog.getByRole("textbox", { name: "Reason" }),
      "Balance reconciled with student",
    );
    await user.click(dialog.getByRole("button", { name: "Save total" }));
    expect(
      await screen.findByText(/Remaining credit total updated/),
    ).toBeInTheDocument();
  });
  it("saves a 75% public slot visibility preference", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={["/coach/bookings"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.click(
      await screen.findByRole("button", { name: "Availability" }),
    );
    const visibility = await screen.findByRole("combobox", {
      name: /Show this share of open times/i,
    });
    await user.selectOptions(visibility, "75");
    await user.click(screen.getByRole("button", { name: "Save visibility" }));
    expect(
      await screen.findByText(/Booking page and booking preferences saved/),
    ).toBeInTheDocument();
  });
});
