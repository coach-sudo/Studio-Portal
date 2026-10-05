import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoSnapshot } from "../../data/demo";
import { PaymentReminderSteps } from "./PaymentReminderSteps";
import { demoRules } from "./automation/demoRules";
const mock = vi.hoisted(() => ({
  command: vi.fn(),
  rows: [] as Record<string, unknown>[],
  rules: [] as Record<string, unknown>[],
}));
vi.mock("../../data/bookingCommands", () => ({ studioCommand: mock.command }));
vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        or: () => query,
        order: () => query,
        limit: () => query,
        abortSignal: async () => ({
          data: table === "automation_rules" ? mock.rules : mock.rows,
          error: null,
        }),
      };
      return query;
    },
  },
}));
const now = Date.parse("2026-10-05T12:00:00Z");
function setup(paymentStatus: "due" | "paid" = "due") {
  const data = structuredClone(demoSnapshot);
  data.bookings = [];
  data.lessonParticipants = [];
  data.packages = [];
  data.creditEntries = [];
  data.outbox = [];
  data.lessons = [
    {
      ...data.lessons[0],
      startsAt: "2026-10-06T12:00:00Z",
      endsAt: "2026-10-06T13:00:00Z",
      status: "scheduled",
      paymentStatus,
      priceMinor: 8500,
      paidMinor: paymentStatus === "paid" ? 8500 : 0,
      packageId: undefined,
    },
  ];
  const student = data.students.find(
    (row) => row.id === data.lessons[0].studentId,
  )!;
  mock.rules = demoRules(data)
    .filter((rule) => rule.rule_key === "payment_due")
    .map((rule) => ({
      ...rule,
      id: "payment-rule",
      enabled: true,
      mode: "automatic",
    }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PaymentReminderSteps
          data={data}
          student={student}
          isDemo={false}
          now={now}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { data, student };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.rows = [];
  mock.rules = [];
});
describe("coach payment reminder workflow", () => {
  it("previews without sending, prepares drafts, then approves the scheduled message separately", async () => {
    const user = userEvent.setup();
    const f = setup();
    mock.command.mockImplementation(async (_domain, input) => {
      if (input.command === "test_rule")
        return {
          resource: {
            decision: {
              eligible: true,
              explanation: "Recorded balance remains due.",
              stages: [{ key: "hours-24", sendAt: "2026-10-05T12:00:00Z" }],
            },
            recipients: {
              recipients: [{ name: "Payer", email: "payer@example.test" }],
              unresolved: [],
            },
          },
        };
      if (input.command === "run_rule") {
        mock.rows = [
          {
            id: "draft",
            version: 1,
            student_id: f.student.id,
            lesson_id: f.data.lessons[0].id,
            recipient_intent: "payment_due",
            recipient: "payer@example.test",
            subject: "Payment reminder",
            body: "Please review the recorded $85.00 balance.",
            status: "draft",
            attempts: 0,
            event_key: "automation.payment_due.hours-24",
            send_at: "2026-10-05T12:00:00Z",
            updated_at: "2026-10-05T12:00:00Z",
          },
        ];
        return { resource: { result: "draft" } };
      }
      mock.rows = mock.rows.map((row) => ({
        ...row,
        status: "queued",
        version: 2,
        entity_snapshot: { approvedAt: "2026-10-05T12:00:00Z" },
      }));
      return { resource: {} };
    });
    await user.click(
      await screen.findByRole("button", { name: "Review payment reminder" }),
    );
    expect(
      await screen.findByText(/Payer \(payer@example.test\)/),
    ).toBeVisible();
    expect(mock.command).toHaveBeenCalledTimes(1);
    expect(mock.command.mock.calls[0][1].command).toBe("test_rule");
    await user.click(
      screen.getByRole("button", { name: "Prepare reminder drafts" }),
    );
    expect(await screen.findByText(/Awaiting coach approval/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Approve scheduled reminder" }),
    );
    expect(
      await screen.findByText(/Reminder scheduled to be sent on/),
    ).toBeVisible();
    expect(mock.command.mock.calls.map((call) => call[1].command)).toEqual([
      "test_rule",
      "run_rule",
      "approve_message",
    ]);
    expect(mock.command.mock.calls[2][1]).toMatchObject({
      entityId: "draft",
      expectedVersion: 1,
    });
  });
  it("does not demand a package or offer a payer reminder for a paid PAYG lesson", async () => {
    setup("paid");
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Open lesson" })).toBeVisible(),
    );
    expect(screen.queryByText(/No package attached/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review payment reminder" }),
    ).not.toBeInTheDocument();
    expect(mock.command).not.toHaveBeenCalled();
  });
  it("shows sent history and offers no duplicate reminder action", async () => {
    mock.rows = [
      {
        id: "sent",
        version: 2,
        status: "sent",
        event_key: "automation.payment_due.hours-24",
        recipient_intent: "payment_due",
        recipient: "payer@example.test",
        subject: "Reminder",
        body: "Balance",
        attempts: 1,
        lesson_id: demoSnapshot.lessons[0].id,
        updated_at: "2026-10-05T12:00:00Z",
      },
    ];
    setup();
    expect(await screen.findByText(/Reminder sent/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Review payment reminder" }),
    ).not.toBeInTheDocument();
  });
});
