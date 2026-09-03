import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";

function renderApp(path: string) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>);
}

describe("unified inbox", () => {
  it("lets the coach send and immediately undo a private message", async () => {
    const user = userEvent.setup();
    renderApp("/coach/inbox?student=student-maya");
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Message"), "Can you bring the revised scene?");
    await user.click(screen.getByRole("button", { name: /^Send$/ }));
    expect(await screen.findByText("Can you bring the revised scene?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Undo/ }));
    expect(screen.queryByText("Can you bring the revised scene?")).not.toBeInTheDocument();
    expect(screen.getByText("Message undone.")).toBeInTheDocument();
  });

  it("replaces text messaging with the shared portal inbox", async () => {
    renderApp("/portal");
    expect(await screen.findByRole("link", { name: /Message coach/i })).toHaveAttribute("href", "/portal/inbox");
    expect(screen.queryByText(/Text coach/i)).not.toBeInTheDocument();
  });

  it("closes the email dialog after queueing and offers an undo window", async () => {
    const user = userEvent.setup();
    renderApp("/coach/inbox");
    await user.click(await screen.findByRole("button", { name: /Send email/i }));
    await user.type(screen.getByLabelText("Recipient"), "maya@example.com");
    await user.type(screen.getByLabelText("Subject"), "Quick update");
    await user.type(screen.getByLabelText("Message", { selector: "textarea" }), "Your materials are ready.");
    await user.click(screen.getByRole("button", { name: "Queue email" }));
    expect(screen.queryByRole("dialog", { name: "Send email" })).not.toBeInTheDocument();
    expect(await screen.findByText("Email queued")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Undo/ }));
    expect(screen.getByText("Email send undone.")).toBeInTheDocument();
  });

  it("opens a coach-visible linked-contact profile", async () => {
    renderApp("/coach/students/student-sarah/contacts/contact-dana");
    expect(await screen.findByRole("heading", { name: "Dana Patterson" })).toBeInTheDocument();
    expect(screen.getByText(/Parent for Sarah/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Email Dana/i })).toHaveAttribute("href", expect.stringContaining("/coach/inbox"));
  });

  it("routes a class to its inbox instead of rendering a message board", async () => {
    renderApp("/coach/classes/offering-scene-night");
    expect(await screen.findByRole("heading", { name: "August Scene Night" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Class board/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open class inbox/i })).toHaveAttribute("href", "/coach/inbox?offering=offering-scene-night");
  });

  it("exposes stable public links for services and package products", async () => {
    const first = renderApp("/coach/bookings?view=services");
    expect((await screen.findAllByRole("link", { name: "Direct link" }))[0]).toHaveAttribute("href", expect.stringMatching(/^\/book\//));
    first.unmount();
    renderApp("/coach/finance");
    expect((await screen.findAllByRole("link", { name: "Direct link" }))[0]).toHaveAttribute("href", expect.stringMatching(/^\/package\//));
  });
});
