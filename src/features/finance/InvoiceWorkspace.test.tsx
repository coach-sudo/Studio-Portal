import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { InvoiceWorkspace } from "./InvoiceWorkspace";
import { StudioStoreProvider, useStudioStore } from "../../state/StudioStore";
import { demoSnapshot } from "../../data/demo";
import { attentionKey, reportKey } from "../../data/financeCenter";
import type { Invoice } from "../../domain/invoices";
const mocked = vi.hoisted(() => ({ command: vi.fn(), invoices: vi.fn() }));
vi.mock("../../data/bookingCommands", () => ({
  studioCommand: mocked.command,
}));
vi.mock("../../data/invoices", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    useInvoices: (isDemo: boolean, demo: Invoice[]) => {
      const query = useQuery({
        queryKey: ["invoices", "live"],
        enabled: !isDemo,
        queryFn: () => mocked.invoices(),
      });
      return isDemo ? { data: demo } : query;
    },
  };
});

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

it.each([true, false])(
  "refreshes the mounted Finance views only after invoice payment succeeds (%s)",
  async (succeeds) => {
    const user = userEvent.setup();
    const invoice: Invoice = {
      id: "live-invoice",
      studio_id: demoSnapshot.studioId,
      student_id: "student-sarah",
      number: "INV-PAST-DUE",
      status: "open",
      currency: "USD",
      issue_date: "2026-08-01",
      due_date: "2026-08-10",
      introduction: "",
      notes: "",
      footer: "",
      branding: { studioName: "Fixture studio" },
      recipient: { name: "Fixture payer" },
      items: [],
      total_minor: 9000,
      paid_minor: 0,
      credit_minor: 0,
      version: 1,
      created_at: "2026-08-01T00:00:00Z",
    };
    let settled = false;
    mocked.invoices.mockResolvedValue([invoice]);
    let resolvePayment!: (result: { resource: Invoice }) => void;
    let rejectPayment!: (error: Error) => void;
    const payment = new Promise<{ resource: Invoice }>((resolve, reject) => {
      resolvePayment = resolve;
      rejectPayment = reject;
    });
    mocked.command.mockReturnValue(payment);
    const summary = vi.fn(async () =>
      settled
        ? "Collected $90, outstanding $0, overdue $0"
        : "Collected $0, outstanding $90, overdue $90",
    );
    const attention = vi.fn(async () =>
      settled ? "No overdue issues" : "One overdue issue",
    );
    const history = vi.fn(async () =>
      settled ? "Payment in history" : "No payment in history",
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const overdueReport = [reportKey, "synthetic", "overdue"];
    const unrelated = ["unrelated"];
    client.setQueryData(overdueReport, "Overdue report before payment");
    client.setQueryData(unrelated, "Unrelated data");
    function MountedFinance() {
      const overview = useQuery({
        queryKey: [reportKey, "synthetic", "overview"],
        queryFn: summary,
      });
      const report = useQuery({
        queryKey: [reportKey, "synthetic", "collections"],
        queryFn: history,
      });
      const issues = useQuery({
        queryKey: [attentionKey, "synthetic"],
        queryFn: attention,
      });
      return (
        <>
          <p>{overview.data}</p>
          <p>{report.data}</p>
          <p>{issues.data}</p>
          <InvoiceWorkspace data={demoSnapshot} isDemo={false} />
        </>
      );
    }
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={["/coach/finance?view=payments&invoice=live-invoice"]}
        >
          <StudioStoreProvider>
            <MountedFinance />
          </StudioStoreProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("One overdue issue");
    const record = await screen.findByRole("button", {
      name: /^Record payment$/,
    });
    await user.click(record);
    expect(record).toBeDisabled();
    await user.click(record);
    expect(mocked.command).toHaveBeenCalledExactlyOnceWith(
      "invoices",
      expect.objectContaining({
        command: "record_payment",
        entityId: invoice.id,
        expectedVersion: 1,
      }),
    );
    expect(summary).toHaveBeenCalledTimes(1);
    expect(attention).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Invoice updated.")).not.toBeInTheDocument();
    if (succeeds) {
      settled = true;
      const paid = {
        ...invoice,
        status: "paid" as const,
        paid_minor: 9000,
        version: 2,
      };
      mocked.invoices.mockResolvedValue([paid]);
      await act(async () => resolvePayment({ resource: paid }));
      expect(
        await screen.findByText("Collected $90, outstanding $0, overdue $0"),
      ).toBeInTheDocument();
      expect(await screen.findByText("Payment in history")).toBeInTheDocument();
      expect(await screen.findByText("No overdue issues")).toBeInTheDocument();
      expect(mocked.invoices).toHaveBeenCalledTimes(2);
    } else {
      await act(async () =>
        rejectPayment(new Error("Payment could not be recorded.")),
      );
      expect(
        await screen.findAllByText("Payment could not be recorded."),
      ).not.toHaveLength(0);
      expect(screen.queryByText("Invoice updated.")).not.toBeInTheDocument();
      expect(
        screen.getByText("Collected $0, outstanding $90, overdue $90"),
      ).toBeInTheDocument();
      expect(screen.getByText("One overdue issue")).toBeInTheDocument();
      expect(history).toHaveBeenCalledTimes(1);
      expect(summary).toHaveBeenCalledTimes(1);
      expect(attention).toHaveBeenCalledTimes(1);
      expect(mocked.invoices).toHaveBeenCalledTimes(1);
    }
    expect(client.getQueryState(overdueReport)?.isInvalidated).toBe(succeeds);
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
    await waitFor(() => expect(mocked.command).toHaveBeenCalledTimes(1));
  },
);
