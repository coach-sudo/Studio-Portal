import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { InvoiceWorkspace } from "./InvoiceWorkspace";
import { StudioStoreProvider, useStudioStore } from "../../state/StudioStore";
import { demoSnapshot } from "../../data/demo";
const mocked = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("../../data/bookingCommands", () => ({
  studioCommand: mocked.command,
}));

function renderWorkspace({ live = false, noPayer = false } = {}) {
  function Workspace() {
    const { snapshot } = useStudioStore();
    const data = noPayer ? { ...snapshot, linkedContacts: [] } : snapshot;
    return (
      <InvoiceWorkspace data={data} isDemo={!live} studentId="student-sarah" />
    );
  }
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <StudioStoreProvider>
          <Workspace />
        </StudioStoreProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
});
it("previews and saves an invoice billed to the household payer", async () => {
  const user = userEvent.setup();
  renderWorkspace();
  await user.click(screen.getByRole("button", { name: "Create invoice" }));
  expect(screen.getByText("Bill to: Dana Patterson")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add service" }));
  await user.click(screen.getByRole("button", { name: "Preview invoice" }));
  const preview = screen.getByRole("article", { name: "Invoice DRAFT" });
  expect(within(preview).getByText("Dana Patterson")).toBeInTheDocument();
  expect(within(preview).getByText("dana@example.com")).toBeInTheDocument();
  expect(
    within(preview).getByText(
      `For student: ${demoSnapshot.students.find((student) => student.id === "student-sarah")!.fullName}`,
    ),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Issue and send invoice" }),
  );
  expect(
    screen.getAllByText(
      /Demo invoice issued for Dana Patterson. No email was sent/,
    ).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getByRole("article", { name: /^Invoice INV-/ }),
  ).toHaveTextContent("Dana Patterson");
  const pay = screen.getByRole("button", { name: "Pay invoice" });
  expect(pay).toBeEnabled();
  await user.click(pay);
  expect(
    screen.getAllByText(/No demo payment was created/).length,
  ).toBeGreaterThan(0);
});
it("offers a draft but blocks sending when the household payer is missing", async () => {
  const user = userEvent.setup();
  renderWorkspace({ noPayer: true });
  await user.click(screen.getByRole("button", { name: "Create invoice" }));
  expect(screen.getByText(/A minor needs a linked payer/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Issue and send invoice" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Add service" }));
  await user.click(screen.getByRole("button", { name: "Save draft" }));
  expect(
    screen.getAllByText("Draft saved. No email was sent.").length,
  ).toBeGreaterThan(0);
});
