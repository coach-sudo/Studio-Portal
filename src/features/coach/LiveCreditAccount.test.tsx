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
