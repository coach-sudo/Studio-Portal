import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { demoSnapshot } from "../../data/demo";
import { loadReferralOverview } from "../../data/referrals";
import { CoachReferrals, StudentReferrals } from "./Referrals";

vi.mock("../../data/referrals", () => ({ loadReferralOverview: vi.fn() }));
vi.mock("../../hooks/useStudio", () => ({
  useStudioRoute: () => ({
    data: structuredClone(demoSnapshot),
    isDemo: false,
  }),
}));
const response = {
  config: demoSnapshot.settings.referralProgram,
  students: [{ id: "one", name: "Learner", code: "ABC" }],
  referrals: [],
  rewards: [],
};
beforeEach(() => {
  vi.mocked(loadReferralOverview).mockReset();
});

it("loads once despite rebuilt route arrays and permits explicit refresh", async () => {
  vi.mocked(loadReferralOverview).mockResolvedValue(response);
  render(
    <MemoryRouter>
      <CoachReferrals />
    </MemoryRouter>,
  );
  await screen.findByText("Learner");
  await act(async () => {
    await Promise.resolve();
  });
  expect(loadReferralOverview).toHaveBeenCalledTimes(1);
  fireEvent.change(
    screen.getByPlaceholderText("Search student or referral code"),
    {
      target: { value: "Learner" },
    },
  );
  expect(loadReferralOverview).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(loadReferralOverview).toHaveBeenCalledTimes(2));
});

it("does not automatically retry failed reads on state changes", async () => {
  vi.mocked(loadReferralOverview).mockRejectedValue(new Error("Unavailable"));
  render(
    <MemoryRouter>
      <CoachReferrals />
    </MemoryRouter>,
  );
  await screen.findByRole("alert");
  await act(async () => {
    await Promise.resolve();
  });
  expect(loadReferralOverview).toHaveBeenCalledTimes(1);
});

it("aborts the previous student-context read and ignores its late response", async () => {
  let resolveFirst!: (value: typeof response) => void;
  vi.mocked(loadReferralOverview)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValue({
      ...response,
      students: [{ id: "two", name: "Second", code: "DEF" }],
    });
  const props = { settings: demoSnapshot.settings, isDemo: false };
  const first = { ...demoSnapshot.students[0], id: "one" };
  const { rerender } = render(
    <MemoryRouter>
      <StudentReferrals {...props} students={[first]} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(loadReferralOverview).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(loadReferralOverview).mock.calls[0][2]!;
  rerender(
    <MemoryRouter>
      <StudentReferrals {...props} students={[{ ...first, id: "two" }]} />
    </MemoryRouter>,
  );
  await screen.findByDisplayValue(/ref=DEF/);
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolveFirst(response);
  });
  expect(screen.queryByDisplayValue(/ref=ABC/)).not.toBeInTheDocument();
  expect(loadReferralOverview).toHaveBeenCalledTimes(2);
});
