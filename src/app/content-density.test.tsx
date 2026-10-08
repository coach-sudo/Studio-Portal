import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { demoSnapshot } from "../data/demo";
import { TodayView } from "../features/coach/StudioToday";
import { StudioStoreProvider } from "../state/StudioStore";

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

const body = "Keep the complete closing instruction.";
function seedNote() {
  window.localStorage.setItem(
    "stage-story-studio-core-v2",
    JSON.stringify({
      notes: [
        {
          id: "density-note",
          version: 1,
          updatedAt: "2026-10-05T10:00:00Z",
          studentId: "student-maya",
          lessonId: "lesson-maya-next",
          title: "Scene work",
          status: "published",
          body,
          bodyHtml: `<p><strong>Scene objective</strong></p><p>${body}</p><script>window.bad = true</script><img src="x" onerror="window.bad = true">`,
        },
      ],
    }),
  );
}

describe("content disclosure and decision context", () => {
  it("keeps import consequences visible even when the provider has no date", async () => {
    const user = userEvent.setup();
    const data = structuredClone(demoSnapshot);
    data.integrationImports = [
      {
        id: "density-import",
        studioId: data.studioId,
        provider: "google_calendar",
        externalId: "fixture",
        detectedSource: "google_calendar",
        status: "needs_review",
        confidence: 0.8,
        createdAt: "2026-10-05T10:00:00Z",
        updatedAt: "2026-10-05T10:00:00Z",
        payload: { candidate: {} },
      },
    ];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <StudioStoreProvider>
            <TodayView data={data} isDemo />
          </StudioStoreProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Confirming creates or links this lesson in the selected student profile.",
    );
  });
  it("keeps the full welcome message retrievable without hiding primary actions", async () => {
    const user = userEvent.setup();
    const message = "Welcome to the studio. ".repeat(30);
    window.localStorage.setItem(
      "stage-story-studio-core-v2",
      JSON.stringify({ settings: { welcomeMessage: message } }),
    );
    renderApp("/portal");
    const summary = await screen.findByText(
      "Studio welcome message",
      {},
      { timeout: 10000 },
    );
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(
      screen.getByRole("link", { name: "Message coach" }),
    ).toBeInTheDocument();
    await user.click(summary);
    expect(details).toHaveAttribute("open");
    expect(details.querySelector("p")?.textContent).toBe(message);
  });

  it("expands a complete sanitized lesson note and keeps its title visible", async () => {
    seedNote();
    const user = userEvent.setup();
    renderApp("/portal/lessons/lesson-maya-next");
    const summary = await screen.findByText("Read Scene work");
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("Scene work", { exact: true })).toBeInTheDocument();
    await user.click(summary);
    expect(details).toHaveAttribute("open");
    expect(within(details).getByText(body)).toBeInTheDocument();
    expect(details.querySelector("strong")?.textContent).toBe(
      "Scene objective",
    );
    expect(details.querySelector("script, [onerror]")).toBeNull();
  });

  it("shows the complete note immediately in a requested note dialog", async () => {
    seedNote();
    const user = userEvent.setup();
    renderApp("/portal/notes");
    await user.click(await screen.findByRole("button", { name: /1 note/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(body)).toBeInTheDocument();
    expect(dialog.querySelector("details, script, [onerror]")).toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reveals campaign fields and opens the complete preview before queuing", async () => {
    const user = userEvent.setup();
    renderApp("/coach/campaigns");
    const help = await screen.findByText("Personalization fields");
    expect(help.closest("details")).not.toHaveAttribute("open");
    await user.click(help);
    expect(help.closest("details")).toHaveTextContent("{{unsubscribeUrl}}");
    await user.click(screen.getByText("Recipient details"));
    expect(
      screen.getByText(/Student, guardian, and linked-contact addresses/),
    ).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Campaign / template name"),
      "Studio news",
    );
    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(
      screen.getByLabelText("Email body"),
      "Complete campaign message.",
    );
    const preview = screen
      .getByText("Personalized message")
      .closest("details")!;
    expect(preview).not.toHaveAttribute("open");
    await user.click(screen.getByRole("button", { name: "Review send" }));
    expect(preview).toHaveAttribute("open");
    expect(
      within(preview).getByText("Complete campaign message."),
    ).toBeInTheDocument();
    const review = screen.getByRole("region", { name: "Review campaign send" });
    expect(review).toHaveTextContent("unsubscribed addresses are excluded");
    expect(review).toHaveTextContent("includes an unsubscribe link");
    expect(
      within(review).getByRole("button", {
        name: "Sending unavailable in demo",
      }),
    ).toBeDisabled();
  });

  it("keeps coach booking override and notification consequences in the dialog", async () => {
    const user = userEvent.setup();
    renderApp("/coach/bookings");
    await user.click(
      await screen.findByRole("button", { name: "New booking" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleDescription(
      "May override public notice and pricing. Bookings are audited and create calendar and email work.",
    );
    expect(dialog.querySelector("header details")).toBeNull();
  });

  it("retains labeled student creation and dialog focus behavior without its introduction", async () => {
    const user = userEvent.setup();
    renderApp("/coach/students");
    const trigger = await screen.findByRole("button", { name: "Add student" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Add student" });
    expect(dialog).not.toHaveAttribute("aria-describedby");
    expect(
      within(dialog).getByRole("button", { name: "Close" }),
    ).toHaveAccessibleName("Close");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });
});
