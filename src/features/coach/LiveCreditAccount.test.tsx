import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { CreditCoverage } from "../../domain/creditCoverage";
import { LiveCreditAccount } from "./LiveCreditAccount";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  command: vi.fn(),
  version: 1,
}));
vi.mock("../../data/creditCoverage", () => ({
  loadCreditCoverage: mocks.load,
}));
vi.mock("../../data/bookingCommands", () => ({ studioCommand: mocks.command }));
vi.mock("../../hooks/usePrivateIdentity", () => ({
  usePrivateIdentity: () => "actor-one",
}));
vi.mock("../../hooks/useStudio", () => ({
  invalidateStudioDomains: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../components/StudentCreditHistory", () => ({
  StudentCreditHistory: () => null,
}));
const sid = "10000000-0000-4000-8000-000000000001";
function coverage(): CreditCoverage {
  return {
    studentId: sid,
    evaluatedAt: "2026-10-15T12:00:00Z",
    previewEnable: false,
    settingReasonCode: null,
    lessonsVisible: true,
    summary: {
      version: mocks.version,
      remaining: 2,
      reserved: 0,
      available: 2,
      expired: 0,
      autoApply: false,
      needsReview: false,
    },
    items: [],
    page: 1,
    pageSize: 10,
    total: 0,
    hasMore: false,
    counts: { covered: 0, eligible: 0, uncovered: 0, reviewRequired: 0 },
  };
}
function mount(readOnly = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LiveCreditAccount
          studentId={sid}
          timezone="America/New_York"
          readOnly={readOnly}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  mocks.version = 1;
  mocks.command.mockReset();
  mocks.load.mockReset().mockImplementation(async () => coverage());
});
it("retains the original key and version after a lost response even when refreshed totals advance", async () => {
  const user = userEvent.setup();
  mocks.command
    .mockImplementationOnce(async () => {
      mocks.version = 2;
      throw new TypeError("Lost response");
    })
    .mockResolvedValueOnce({
      resource: {
        applied: 1,
        alreadyCovered: 0,
        skipped: 0,
        failed: 0,
        skipReasons: {},
        failureCodes: {},
        autoApplyPending: false,
      },
    });
  const client = mount();
  const apply = await screen.findByRole("button", {
    name: "Apply eligible credits now",
  });
  await user.click(apply);
  await screen.findByText(/Lost response/);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  await user.click(apply);
  await screen.findByText(/1 newly covered/);
  const first = mocks.command.mock.calls[0][1],
    retry = mocks.command.mock.calls[1][1];
  expect(retry.idempotencyKey).toBe(first.idempotencyKey);
  expect(retry.expectedVersion).toBe(1);
  expect(retry.payload).toEqual({ studentId: sid });
  client.clear();
});
it("does not expose actions or logistics for finance-only read-only responses", async () => {
  mocks.load.mockResolvedValue({
    ...coverage(),
    lessonsVisible: false,
    items: [],
    counts: null,
    total: null,
  });
  const client = mount(true);
  await screen.findByText("Your coach manages this setting.");
  expect(
    screen.queryByRole("button", { name: "Apply eligible credits now" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Upcoming coverage/)).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  client.clear();
});

it("reviews a removal before sending the confirmed total and balance", async () => {
  const user = userEvent.setup();
  const client = mount();
  mocks.command.mockResolvedValue({ resource: {} });
  await user.click(
    await screen.findByRole("button", { name: "Manage credits" }),
  );
  await user.selectOptions(screen.getByLabelText("Adjustment"), "remove");
  await user.type(screen.getByRole("spinbutton"), "1");
  await user.type(screen.getByLabelText("Reason"), "Duplicate grant");
  await user.click(screen.getByRole("button", { name: "Review adjustment" }));
  expect(
    await screen.findByText("Unused Credits change from 2 to 1."),
  ).toBeInTheDocument();
  expect(mocks.command).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Confirm credit adjustment" }),
  );
  await screen.findByText(/Credit balance saved/);
  expect(mocks.command).toHaveBeenCalledWith(
    "credits",
    expect.objectContaining({
      command: "set_total",
      expectedVersion: 1,
      payload: {
        studentId: sid,
        total: 1,
        reason: "Duplicate grant",
        reviewedBalance: { remaining: 2, available: 2, reserved: 0 },
      },
    }),
  );
  client.clear();
});

it("blocks removing a reserved credit", async () => {
  const user = userEvent.setup();
  mocks.load.mockResolvedValue({
    ...coverage(),
    summary: { ...coverage().summary, reserved: 1, available: 1 },
  });
  const client = mount();
  await user.click(
    await screen.findByRole("button", { name: "Manage credits" }),
  );
  await user.selectOptions(screen.getByLabelText("Adjustment"), "remove");
  await user.type(screen.getByRole("spinbutton"), "2");
  await user.type(screen.getByLabelText("Reason"), "Duplicate grant");
  expect(
    screen.getByRole("button", { name: "Review adjustment" }),
  ).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "This would remove reserved credits",
  );
  expect(mocks.command).not.toHaveBeenCalled();
  client.clear();
});

it("keeps incompatible package balances separate on the shared account surface", async () => {
  mocks.load.mockResolvedValue({
    ...coverage(),
    packages: [
      {
        id: "package-30",
        name: "Audition package",
        services: ["Audition"],
        durationMinutes: 30,
        eligibilityVerified: true,
        expiresAt: null,
        unused: 2,
        reserved: 1,
        available: 1,
        consumed: 3,
      },
      {
        id: "package-60",
        name: "Coaching package",
        services: ["Coaching"],
        durationMinutes: 60,
        eligibilityVerified: true,
        expiresAt: null,
        unused: 4,
        reserved: 0,
        available: 4,
        consumed: 1,
      },
    ],
  });
  const client = mount(true);
  expect(await screen.findByText("Audition · 30 min")).toBeVisible();
  expect(screen.getByText("Coaching · 60 min")).toBeVisible();
  expect(
    screen.getByText("2 unused · 1 reserved · 1 available · 3 consumed"),
  ).toBeVisible();
  expect(
    screen.getByText("4 unused · 0 reserved · 4 available · 1 consumed"),
  ).toBeVisible();
  expect(screen.queryByText("Available to Book")).not.toBeInTheDocument();
  client.clear();
});
