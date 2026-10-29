import { beforeEach, expect, it, vi } from "vitest";
import {
  listAccessibleCalendars,
  continueCalendarDiscovery,
  loadDiscoveryProgress,
} from "./calendarDiscovery";
const f = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("./bookingCommands", () => ({ studioCommand: f.command }));
const scan = "e8000000-0000-4000-8000-000000000001",
  other = "e8000000-0000-4000-8000-000000000002";
beforeEach(() => vi.resetAllMocks());
it("does not turn a missing continuation into complete Calendar coverage", async () => {
  f.command.mockResolvedValue({
    resource: { items: [], hasMore: true, nextCursor: null },
  });
  await expect(listAccessibleCalendars()).rejects.toThrow(
    "could not be verified",
  );
});
it("rejects a successful checkpoint for a different page instead of claiming the requested work finished", async () => {
  f.command.mockResolvedValue({
    resource: {
      scanId: scan,
      calendarId: "alpha",
      pageSequence: 1,
      observed: 25,
      checkpointCommitted: true,
    },
  });
  await expect(
    continueCalendarDiscovery(
      { scanId: scan, calendarId: "alpha", pageSequence: 0 },
      "e2e-stable-page-key",
    ),
  ).rejects.toThrow("does not match");
  expect(f.command.mock.calls[0][1].idempotencyKey).toBe("e2e-stable-page-key");
});
it("preserves record context when a progress response belongs to a different saved preview", async () => {
  f.command.mockResolvedValue({
    resource: {
      scanId: other,
      from: "2020-01-01T00:00Z",
      to: "2020-02-01T00:00Z",
      timezone: "UTC",
      status: "completed",
      total: 0,
      hasMore: false,
      nextCursor: null,
      sources: [],
      items: [],
    },
  });
  await expect(loadDiscoveryProgress(scan)).rejects.toThrow(
    "does not match this record",
  );
});
