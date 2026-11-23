import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoSnapshot } from "../../data/demo";
import { financePeriod } from "../../data/financeCenter";
import { FinanceCenter } from "./FinanceCenter";

const mock = vi.hoisted(() => ({
  report: vi.fn(),
  attention: vi.fn(),
  action: vi.fn(),
}));
vi.mock("../../data/financeCenter", async (original) => ({
  ...(await original<typeof import("../../data/financeCenter")>()),
  useFinanceReport: mock.report,
  useFinanceAttention: mock.attention,
  changeAttention: mock.action,
}));
vi.mock("../finance/InvoiceWorkspace", () => ({
  InvoiceWorkspace: () => <p>Invoice workspace</p>,
}));

const row = {
  id: "b8200000-0000-4000-8000-000000000011",
  kind: "payment",
  currency: "USD",
  amount: 6500,
  date_on: "2026-11-10",
  student: "Synthetic Learner",
  payer: null,
  title: "Private lesson",
  status: "settled",
  service: "Private Coaching",
  href: "/coach/students/stu/payments?payment=pay",
};
const issue = {
  id: "b8200000-0000-4000-8000-000000000012",
  student: "Synthetic Learner",
  kind: "overdue_invoice",
  severity: 3,
  title: "INV-014",
  href: "/coach/students/stu/payments?invoice=one",
  state: "open",
  version: 1,
  evidence: { dueDate: "2026-10-15" },
  first_seen: "2026-10-16T12:00:00Z",
  changed_at: "2026-10-16T12:00:00Z",
  history: [],
};
function show(url = "/coach/finance") {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <FinanceCenter
          data={demoSnapshot}
          isDemo={false}
          packages={<p>Package management</p>}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mock.report.mockReset().mockReturnValue({
    data: {
      totals: [{ metric: "gross", currency: "USD", amount: 6500 }],
      trend: [
        { date_on: "2026-11-10", currency: "USD", gross: 6500, refunds: 0 },
      ],
      reportTotals: [{ kind: "payment", currency: "USD", amount: 6500 }],
      services: [],
      count: 36,
      rows: [row],
    },
  });
  mock.attention
    .mockReset()
    .mockReturnValue({ data: { count: 1, items: [issue] } });
  mock.action.mockReset().mockResolvedValue(false);
});

describe("Finance Command Center", () => {
  it("provides four primary views and opens reports from Overview", () => {
    show();
    const nav = screen.getByRole("navigation", { name: "Finance views" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((item) => item.textContent),
    ).toEqual(["Overview", "Payments", "Packages & Credits", "Attention"]);
    expect(
      screen.getByRole("heading", { name: "Collections trend" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "$65.00" }));
    expect(
      screen.getByRole("dialog", { name: "Gross collections" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Private lesson" }),
    ).toHaveAttribute("href", row.href);
    expect(mock.report.mock.calls.at(-1)?.[2]).toMatchObject({
      group: "gross",
      currency: "USD",
    });
  });

  it("passes search, report dates, and pagination to the server query", () => {
    show(
      "/coach/finance?view=payments&period=custom&from=2026-11-01&to=2026-11-30",
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "learner" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(mock.report.mock.calls.at(-1)?.slice(1, 3)).toEqual([
      { start: "2026-11-01", end: "2026-11-30" },
      expect.objectContaining({
        group: "collections",
        search: "learner",
        page: 2,
      }),
    ]);
    expect(screen.getByText("Invoice workspace")).toBeInTheDocument();
  });

  it("acknowledges an issue without offering dismissal of an overdue balance", async () => {
    show("/coach/finance?view=attention");
    expect(
      screen.queryByRole("button", { name: "Dismiss" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(await screen.findByText("Issue updated.")).toBeInTheDocument();
    expect(mock.action).toHaveBeenCalledWith(demoSnapshot.studioId, {
      id: issue.id,
      version: 1,
      action: "acknowledge",
    });
  });
});

it("applies studio calendar boundaries rather than browser UTC", () => {
  const utc = new Date("2026-11-01T02:00:00Z");
  expect(financePeriod("this-month", "America/New_York", utc)).toEqual({
    start: "2026-10-01",
    end: "2026-10-31",
  });
  expect(financePeriod("last-month", "America/New_York", utc)).toEqual({
    start: "2026-09-01",
    end: "2026-09-30",
  });
});
