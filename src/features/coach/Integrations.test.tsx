import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Integrations } from "./StudioSettings";
import { workerHealth } from "../../domain/integrationHealth";
import type { PlatformHealth } from "../../data/bookingCommands";
const mock = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../../data/bookingCommands", async (original) => ({
  ...(await original<typeof import("../../data/bookingCommands")>()),
  startProviderIntake: mock.dispatch,
}));
const base: PlatformHealth = {
  mode: "live",
  supabase: true,
  stripe: false,
  gmail: false,
  googleCalendar: false,
  scheduledWorkers: false,
  integrations: {
    googleCalendar: {
      configured: true,
      state: "configured_unverified",
      lastSuccessAt: null,
    },
  },
};
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("shows disabled intake and prevents a misleading start", () => {
  render(
    <Integrations
      health={{
        ...base,
        workers: { "provider-intake": workerHealth(false, null) },
      }}
      onNotice={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: /Check Calendar & Gmail now/ }),
  ).toBeDisabled();
  expect(
    screen.getByText(/Keep it disabled until controlled provider checks pass/),
  ).toBeInTheDocument();
  expect(mock.dispatch).not.toHaveBeenCalled();
});
it("reports accepted dispatch and polls the receipt without assuming completion", async () => {
  vi.useFakeTimers();
  mock.dispatch.mockResolvedValue({
    status: "accepted",
    jobId: "synthetic-job",
  });
  const notice = vi.fn(),
    refresh = vi.fn().mockResolvedValue(base);
  render(<Integrations health={base} onNotice={notice} onRefresh={refresh} />);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: /Check Calendar & Gmail now/ }),
    );
  });
  expect(notice).toHaveBeenCalledWith(
    expect.stringMatching(/not yet been verified/),
  );
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  expect(refresh).toHaveBeenCalledTimes(2);
  await act(async () => {
    vi.advanceTimersByTime(15000);
  });
  expect(refresh).toHaveBeenCalledTimes(2);
});
