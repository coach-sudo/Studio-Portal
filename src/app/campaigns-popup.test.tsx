import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";

function renderApp(path: string) {
  return render(
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
}

describe("campaign and popup controls", () => {
  it("saves a reusable personalized email template", async () => {
    const user = userEvent.setup();
    renderApp("/coach/campaigns");
    expect(
      await screen.findByRole("heading", { name: "Campaigns" }),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "Campaign / template name" }),
      "Fall update",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Subject" }),
      "Hello {{{{firstName}}}}",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Email body" }),
      "A note from {{{{studioName}}}}.",
    );
    await user.click(screen.getByRole("button", { name: "Save template" }));
    expect(await screen.findByText(/Template saved/)).toBeInTheDocument();
  });

  it("lets the coach configure and preview the daily popup", async () => {
    const user = userEvent.setup();
    renderApp("/coach/settings");
    await user.click(
      await screen.findByRole("button", { name: /Daily popup/i }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Heading" }),
      "New class dates",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Body" }),
      "Registration is open.",
    );
    expect(
      screen.getByRole("heading", { name: "New class dates" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save daily popup" }));
    expect(
      await screen.findByText(/Daily popup settings saved/),
    ).toBeInTheDocument();
  });
});
