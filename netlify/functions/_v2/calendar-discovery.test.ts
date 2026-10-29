// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleCalendarDiscovery } from "./calendar-discovery";
import { DiscoveryProviderError } from "../_shared/calendar-discovery";
import type { V2CommandContext } from "./types";
const f = vi.hoisted(() => ({
  rpc: vi.fn(),
  read: vi.fn(),
  token: vi.fn(),
  page: vi.fn(),
  list: vi.fn(),
  coach: vi.fn(),
  user: vi.fn(),
}));
vi.mock("../_shared/supabase", () => ({
  serviceClient: () => ({ rpc: f.rpc }),
}));
vi.mock("../_shared/google", () => ({ googleAccessToken: f.token }));
vi.mock("../_shared/calendar-discovery", async (original) => ({
  ...(await original<typeof import("../_shared/calendar-discovery")>()),
  calendarDiscoveryPage: f.page,
  accessibleCalendarPage: f.list,
}));
const studio = "e7900000-0000-4000-8000-000000000001",
  actor = "e7900000-0000-4000-8000-000000000002",
  scan = "e7900000-0000-4000-8000-000000000003",
  token = "e7900000-0000-4000-8000-000000000004";
const payload = {
  scanId: scan,
  calendarId: "selected-calendar",
  pageSequence: 0,
};
const claim = {
  replay: false,
  claimToken: token,
  ...payload,
  from: "2020-01-01T00:00Z",
  to: "2020-02-01T00:00Z",
  calendarTimezone: "UTC",
  pageToken: null,
};
const ctx = (command: string, value: Record<string, unknown> = payload) =>
  ({
    domain: "integrations",
    input: {
      command,
      payload: value,
      idempotencyKey: "e2e-discovery-stable-key",
      expectedVersion: 0,
      reason: "Coach reviews sources",
    },
    requireCoach: f.coach,
    db: { rpc: f.read, auth: { getUser: f.user } },
  }) as unknown as V2CommandContext;
beforeEach(() => {
  vi.clearAllMocks();
  f.coach.mockResolvedValue(studio);
  f.user.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  f.token.mockResolvedValue("private-token");
  vi.stubGlobal("Netlify", {
    env: {
      get: (key: string) =>
        key === "GOOGLE_DISCOVERY_STUDIO_ID" ? studio : undefined,
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
it("rejects a non-coach before reading credentials or provider data", async () => {
  f.coach.mockRejectedValue(new Error("FORBIDDEN"));
  await expect(
    handleCalendarDiscovery(ctx("list_calendars", {})),
  ).rejects.toThrow("FORBIDDEN");
  expect(f.user).not.toHaveBeenCalled();
  expect(f.token).not.toHaveBeenCalled();
  expect(f.rpc).not.toHaveBeenCalled();
});
it("requires explicit studio binding for global Google credentials", async () => {
  vi.stubGlobal("Netlify", { env: { get: () => undefined } });
  await expect(
    handleCalendarDiscovery(ctx("list_calendars", {})),
  ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
  expect(f.token).not.toHaveBeenCalled();
});
it("stores a requested preview using the authenticated actor and stable key without invoking Google or canonical work", async () => {
  f.rpc.mockResolvedValue({
    data: { scanId: scan, accepted: true, statusAtAcceptance: "queued" },
    error: null,
  });
  const response = await handleCalendarDiscovery(
    ctx("start_calendar_discovery", {
      from: "2020-01-01T00:00:00Z",
      to: "2020-02-01T00:00:00Z",
      timezone: "UTC",
      calendars: [{ id: "selected-calendar" }],
    }),
  );
  expect(response?.status).toBe(202);
  expect(f.rpc.mock.calls[0]).toMatchObject([
    "start_calendar_discovery",
    { p_actor: actor, p_studio: studio, p_key: "e2e-discovery-stable-key" },
  ]);
  expect(f.token).not.toHaveBeenCalled();
});
it("reads saved progress using the user JWT even when provider discovery is not configured", async () => {
  vi.stubGlobal("Netlify", { env: { get: () => undefined } });
  f.read.mockResolvedValue({
    data: { status: "partial", total: 251 },
    error: null,
  });
  const response = await handleCalendarDiscovery(
    ctx("calendar_discovery_progress", { scanId: scan }),
  );
  expect(await response?.json()).toEqual({
    resource: { status: "partial", total: 251 },
  });
  expect(f.read).toHaveBeenCalledWith("calendar_discovery_progress", {
    p_scan: scan,
    p_cursor: undefined,
  });
  expect(f.rpc).not.toHaveBeenCalled();
});
it("recovers a lost checkpoint response by receipt without repeating the provider page", async () => {
  const result = {
    scanId: scan,
    pageSequence: 0,
    observed: 250,
    checkpointCommitted: true,
  };
  f.rpc
    .mockResolvedValueOnce({ data: claim, error: null })
    .mockResolvedValueOnce({
      data: null,
      error: { message: "private-token synthetic lost response" },
    })
    .mockResolvedValueOnce({ data: false, error: null })
    .mockResolvedValueOnce({ data: { replay: true, result }, error: null });
  f.page.mockResolvedValue({ items: [], nextPageToken: null });
  await expect(
    handleCalendarDiscovery(ctx("continue_calendar_discovery")),
  ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
  const response = await handleCalendarDiscovery(
    ctx("continue_calendar_discovery"),
  );
  expect(await response?.json()).toMatchObject({
    resource: result,
    canonicalEffects: [],
  });
  expect(f.token).toHaveBeenCalledOnce();
  expect(f.page).toHaveBeenCalledOnce();
  expect(f.rpc.mock.calls[0]).toEqual(f.rpc.mock.calls[3]);
});
it("persists a sanitized per-calendar failure without advancing a checkpoint", async () => {
  f.rpc
    .mockResolvedValueOnce({ data: claim, error: null })
    .mockResolvedValueOnce({ data: true, error: null });
  f.page.mockRejectedValue(new DiscoveryProviderError("access_denied"));
  await expect(
    handleCalendarDiscovery(ctx("continue_calendar_discovery")),
  ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
  expect(f.rpc.mock.calls[1]).toEqual([
    "fail_calendar_discovery_page",
    {
      p_scan: scan,
      p_calendar: "selected-calendar",
      p_claim: token,
      p_code: "access_denied",
    },
  ]);
});
it("does not fetch an already running page or assume completion", async () => {
  f.rpc.mockResolvedValue({
    error: { message: "DISCOVERY_RUNNING" },
    data: null,
  });
  await expect(
    handleCalendarDiscovery(ctx("continue_calendar_discovery")),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT", retryable: true });
  expect(f.token).not.toHaveBeenCalled();
});
it("checks failure-observation writes rather than claiming recovery was saved", async () => {
  f.rpc
    .mockResolvedValueOnce({ data: claim, error: null })
    .mockResolvedValueOnce({
      data: null,
      error: { message: "synthetic observation failure" },
    });
  f.page.mockRejectedValue(new DiscoveryProviderError("rate_limited"));
  await expect(
    handleCalendarDiscovery(ctx("continue_calendar_discovery")),
  ).rejects.toMatchObject({
    message: expect.stringContaining("recovery status could not be saved"),
    retryable: true,
  });
});
