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

function renderWorkspace({
  live = false,
  noPayer = false,
  studentId = "student-sarah",
} = {}) {
  function Workspace() {
    const { snapshot } = useStudioStore();
    const data = noPayer ? { ...snapshot, linkedContacts: [] } : snapshot;
    return (
      <InvoiceWorkspace data={data} isDemo={!live} studentId={studentId} />
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
  window.localStorage.removeItem("stage-story-studio-core-v2");
});
it("sets up an adult self-payer during review without losing the selected lesson", async () => {
  const user = userEvent.setup();
  const studentId = "student-maya";
  const service = demoSnapshot.bookingServices.find(
    (item) => item.id === "service-private-60",
  )!;
  window.localStorage.setItem(
    "stage-story-studio-core-v2",
    JSON.stringify({
      students: demoSnapshot.students.map((student) =>
        student.id === studentId
          ? {
              ...student,
              isMinor: false,
              email: undefined,
              paymentMethodSummary: undefined,
            }
          : student,
      ),
      lessons: [
        {
          ...demoSnapshot.lessons[0],
          id: "contextual-verified-lesson",
          studentId,
          topic: "Verified $80 lesson",
          serviceId: service.id,
          sourceProvider: "studio",
          status: "scheduled",
          priceMinor: 8000,
          paidMinor: 0,
          paymentStatus: "due",
          packageId: undefined,
          invoiceId: undefined,
        },
      ],
    }),
  );
  renderWorkspace({ studentId });
  await user.click(screen.getByRole("button", { name: "Send invoice" }));
  await user.click(
    screen.getByRole("checkbox", { name: /Verified \$80 lesson/ }),
  );
  await user.click(screen.getByRole("button", { name: "Review invoice" }));
  const review = within(screen.getByRole("dialog", { name: "Review invoice" }));
  expect(review.getByRole("button", { name: "Issue invoice" })).toBeDisabled();
  await user.click(review.getByRole("button", { name: "Set up payer" }));
  await user.type(
    review.getByRole("textbox", { name: "Student email" }),
    "self@example.test",
  );
  await user.click(review.getByRole("button", { name: "Save payer" }));
  expect(review.getByText("self@example.test")).toBeInTheDocument();
  expect(review.getByText("1 lesson selected")).toBeInTheDocument();
  await user.click(review.getByRole("button", { name: "Issue invoice" }));
  expect(
    screen.getByRole("article", { name: /^Invoice INV-/ }),
  ).toHaveTextContent("self@example.test");
});
it("previews and saves an invoice billed to the household payer", async () => {
  const user = userEvent.setup();
  renderWorkspace();
  await user.click(
    screen.getByRole("button", { name: "Invoice services or packages" }),
  );
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
  await user.click(screen.getByRole("button", { name: "Issue invoice" }));
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
  await user.click(
    screen.getByRole("button", { name: "Invoice services or packages" }),
  );
  expect(screen.getByText(/A minor needs a linked payer/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Issue invoice" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Add service" }));
  await user.click(screen.getByRole("button", { name: "Save draft" }));
  expect(
    screen.getAllByText("Draft saved. No email was sent.").length,
  ).toBeGreaterThan(0);
});
