// @vitest-environment node
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { formatStudioDateTime } from "../../../src/domain/presentation";
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  google: vi.fn(),
  conflict: vi.fn(),
  configured: false,
  coach: true,
}));
vi.mock("./supabase", () => ({
  userClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "synthetic-coach" } },
        error: null,
      }),
    },
    rpc: state.rpc,
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const method of ["select", "eq", "limit", "in", "lt", "gt"])
        q[method] = () => q;
      q.single = async () => ({
        data:
          table === "memberships"
            ? state.coach
              ? { studio_id: "synthetic" }
              : null
            : { duration_minutes: 60 },
        error: null,
      });
      q.then = (resolve: (value: unknown) => void) =>
        resolve({ data: [], error: null });
      return q;
    },
  }),
  serviceClient: vi.fn(() => {
    throw Error("Canonical service writes are forbidden in this handler");
  }),
}));
vi.mock("./google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./google")>()),
  googleAccessToken: state.google,
  googleCalendarConflicts: state.conflict,
}));
import handler from "../booking-admin";
const payload = {
  student_id: "synthetic-student",
  service_id: "synthetic-service",
  starts_at: "2031-11-03T18:00:00Z",
  mark_paid: true,
};
const call = (
  value: Record<string, unknown> = payload,
  key = "e2e-stable-manual",
  command = "create_manual",
) =>
  handler(
    new Request("https://example.test/api/v2/admin/booking/bookings", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ command, payload: value }),
    }),
    {
      params: { resource: "bookings" },
      requestId: "synthetic-request",
    } as never,
  );
beforeEach(() => {
  vi.restoreAllMocks();
  state.configured = false;
  state.coach = true;
  state.google.mockReset().mockRejectedValue(Error("private token response"));
  state.conflict.mockReset().mockResolvedValue([]);
  state.rpc.mockReset().mockImplementation(async (name) => ({
    data:
      name === "manual_booking_replay"
        ? null
        : {
            resource: { id: "one-booking", payment_status: "paid" },
            sideEffects: "pending",
          },
    error: null,
  }));
  vi.stubGlobal("Netlify", {
    env: { get: () => (state.configured ? "synthetic-config" : undefined) },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("requires explicit historical intent rather than inferring attendance from time", async () => {
  expect(
    (await call({ ...payload, starts_at: "2020-01-01T15:00:00Z" })).status,
  ).toBe(422);
  expect(state.rpc).not.toHaveBeenCalledWith(
    "command_create_manual_booking",
    expect.anything(),
  );
});
it("accepts explicit historical recording without a Google dependency", async () => {
  state.configured = true;
  expect(
    (
      await call({
        ...payload,
        starts_at: "2020-01-01T15:00:00Z",
        historical: true,
        historical_outcome: "scheduled",
        historical_financial: "record_only",
      })
    ).status,
  ).toBe(201);
  expect(state.google).not.toHaveBeenCalled();
  expect(state.rpc).toHaveBeenLastCalledWith(
    "command_create_manual_booking",
    expect.objectContaining({ p_external_status: "not_checked" }),
  );
});
it("returns replay before any provider check or canonical re-execution", async () => {
  state.configured = true;
  state.rpc.mockResolvedValue({
    data: { resource: { id: "same-booking" } },
    error: null,
  });
  expect((await call()).status).toBe(201);
  expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(state.google).not.toHaveBeenCalled();
});
it("cannot return paid success when the transactional ledger write is rejected", async () => {
  state.rpc.mockImplementation(async (name) => ({
    data: null,
    error:
      name === "command_create_manual_booking"
        ? { code: "23514", message: "synthetic ledger rejection" }
        : null,
  }));
  const result = await call();
  expect(result.status).toBe(500);
  expect(await result.json()).not.toHaveProperty("resource");
});
it("schedules locally without requiring an unconfigured Google account", async () => {
  expect((await call()).status).toBe(201);
  expect(state.google).not.toHaveBeenCalled();
  expect(state.rpc).toHaveBeenLastCalledWith(
    "command_create_manual_booking",
    expect.objectContaining({
      p_external_status: "not_configured",
      p_key: "e2e-stable-manual",
    }),
  );
});
it("returns committed canonical state with pending effects without compensating writes", async () => {
  const result = await call();
  expect(result.status).toBe(201);
  expect((await result.json()).sideEffects).toBe("pending");
  expect(state.rpc.mock.calls.map((c) => c[0])).toEqual([
    "manual_booking_replay",
    "command_create_manual_booking",
  ]);
});
it("rejects conflicting replay payload and missing coach authority", async () => {
  state.rpc.mockResolvedValue({
    data: null,
    error: { message: "IDEMPOTENCY_CONFLICT" },
  });
  expect((await call()).status).toBe(409);
  state.coach = false;
  expect((await call()).status).toBe(403);
});
it("reports configured Google outage without claiming checks passed", async () => {
  state.configured = true;
  const result = await call();
  expect(result.status).toBe(503);
  expect((await result.json()).message).toMatch(
    /Google conflict checks are unavailable/,
  );
  expect(state.rpc).toHaveBeenCalledTimes(1);
});

it.each(["create", "update", "delete"])(
  "rejects generic booking %s before fragmented writes",
  async (command) => {
    const result = await handler(
      new Request("https://example.test/api/v2/admin/booking/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command,
          id: "e2900000-0000-4000-8000-000000000001",
          expectedVersion: 1,
          payload: { payment_status: "paid", paid_minor: 6000 },
        }),
      }),
      {
        params: { resource: "bookings" },
        requestId: "synthetic-bypass",
      } as never,
    );
    expect(result.status).toBe(422);
    expect((await result.json()).message).toMatch(/reviewed booking action/);
    expect(state.rpc).not.toHaveBeenCalled();
  },
);

const seriesPayload = {
  ...payload,
  mark_paid: false,
  recurrence: "biweekly",
  occurrence_count: 52,
  service_version: 1,
  timezone: "America/New_York",
};
const windows = Array.from({ length: 52 }, (_, index) => {
  // The authoritative DB plan can shift UTC by an hour when local clocks change.
  const starts =
    Date.parse(payload.starts_at) +
    index * 14 * 86_400_000 -
    (index >= 10 && index < 22 ? 3_600_000 : 0);
  return {
    start: new Date(starts).toISOString(),
    end: new Date(starts + 3_600_000).toISOString(),
  };
});

type GoogleQuery = {
  timeMin: string;
  timeMax: string;
  items: { id: string }[];
};
const calendarId = "studio@example.test";
const longSeries = (
  perform: (
    query: GoogleQuery,
    signal: AbortSignal,
  ) => Promise<Response> | Response,
) => {
  state.rpc.mockImplementation(async (name) => ({
    data:
      name === "manual_booking_replay"
        ? null
        : name === "manual_booking_series_plan"
          ? windows
          : { resource: { id: "first-booking" }, lessonId: "first-lesson" },
    error: null,
  }));
  state.configured = true;
  state.google.mockResolvedValue("synthetic-provider-token");
  vi.stubGlobal("Netlify", {
    env: {
      get: (key: string) =>
        key === "GOOGLE_CALENDAR_ID" ? calendarId : "synthetic-config",
    },
  });
  const provider = vi.fn(
    (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      expect(url).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
      return perform(
        JSON.parse(String(init.body)) as GoogleQuery,
        init.signal!,
      );
    },
  );
  vi.stubGlobal("fetch", provider);
  return provider;
};

function free(query: GoogleQuery, busy: { start: string; end: string }[] = []) {
  expect(query.items).toEqual([{ id: calendarId }]);
  return Response.json({
    timeMin: query.timeMin,
    timeMax: query.timeMax,
    calendars: { [calendarId]: { busy } },
  });
}

const previewSeries = () =>
  call(
    { ...seriesPayload, ends_at: windows[0].end },
    undefined,
    "check_conflicts",
  );

it("fits 52 dates in nine FreeBusy reads and revalidates at save including the last date", async () => {
  let saving = false;
  let active = 0;
  let peak = 0;
  const last = windows[51];
  const provider = longSeries(async (query, signal) => {
    active++;
    peak = Math.max(peak, active);
    await delay(250, undefined, { signal });
    active--;
    expect(Date.parse(query.timeMax) - Date.parse(query.timeMin)).toBeLessThan(
      72 * 86_400_000,
    );
    if (saving && query.timeMax === last.end) return free(query, [last]);
    const start = new Date(Date.parse(query.timeMin) - 3_600_000).toISOString();
    return free(query, [
      { start, end: query.timeMin },
      {
        start: new Date(Date.parse(query.timeMin) + 86_400_000).toISOString(),
        end: new Date(Date.parse(query.timeMin) + 90_000_000).toISOString(),
      },
    ]);
  });
  const began = performance.now();
  const preview = await previewSeries();
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({
    resource: { conflicts: [], externalCalendarChecked: true },
  });
  expect(provider).toHaveBeenCalledTimes(9);
  saving = true;
  const response = await call({ ...seriesPayload, allow_conflict: true });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: "SLOT_UNAVAILABLE",
    message: expect.stringContaining(
      formatStudioDateTime(last.start, seriesPayload.timezone),
    ),
  });
  expect(provider).toHaveBeenCalledTimes(18);
  expect(peak).toBe(3);
  expect(performance.now() - began).toBeLessThan(12_000);
  expect(state.rpc).not.toHaveBeenCalledWith(
    "command_create_manual_booking",
    expect.anything(),
  );
});

it("retries one throttled range without re-reading the other eight and saves", async () => {
  let throttled = false;
  const provider = longSeries((query) => {
    if (query.timeMin === windows[0].start && !throttled) {
      throttled = true;
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "1" },
      });
    }
    return free(query);
  });
  const started = performance.now();
  expect((await call(seriesPayload)).status).toBe(201);
  expect(performance.now() - started).toBeGreaterThanOrEqual(950);
  expect(provider).toHaveBeenCalledTimes(10);
  expect(state.rpc).toHaveBeenLastCalledWith("command_create_manual_booking", {
    p_key: "e2e-stable-manual",
    p_value: seriesPayload,
    p_external_status: "checked",
  });
});

it.each([
  "throttled",
  "missing calendar",
  "partial calendar",
  "truncated range",
])(
  "fails closed on a %s result, even with an explicit conflict override",
  async (failure) => {
    const provider = longSeries((query) => {
      if (query.timeMax !== windows[51].end) return free(query);
      if (failure === "throttled")
        return new Response(null, {
          status: 429,
          headers: { "Retry-After": "30" },
        });
      const calendars =
        failure === "missing calendar"
          ? { "another@example.test": { busy: [] } }
          : {
              [calendarId]:
                failure === "partial calendar"
                  ? { errors: [{ reason: "notFound" }], busy: [] }
                  : { busy: [] },
            };
      return Response.json({
        timeMin: query.timeMin,
        timeMax: failure === "truncated range" ? query.timeMin : query.timeMax,
        calendars,
      });
    });
    const response = await call({ ...seriesPayload, allow_conflict: true });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      retryable: true,
      message: expect.stringContaining(
        failure === "throttled"
          ? "limiting availability checks"
          : "Nothing was changed",
      ),
    });
    expect(provider).toHaveBeenCalledTimes(9);
    expect(state.rpc).not.toHaveBeenCalledWith(
      "command_create_manual_booking",
      expect.anything(),
    );
  },
);

it("aborts outstanding reads at the shared deadline without writing the series", async () => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  const deadlines = vi
    .spyOn(AbortSignal, "timeout")
    .mockImplementation((ms) => timeout(ms === 12_000 ? 75 : ms));
  const signals: AbortSignal[] = [];
  const provider = longSeries(async (_query, signal) => {
    signals.push(signal);
    await delay(5_000, undefined, { signal });
    throw new Error("Should have aborted this Google request.");
  });
  const response = await call(seriesPayload);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    message: expect.stringContaining("took too long"),
  });
  expect(deadlines).toHaveBeenCalledWith(12_000);
  expect(deadlines).toHaveBeenCalledWith(3_000);
  expect(provider).toHaveBeenCalledTimes(3);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(state.rpc).not.toHaveBeenCalledWith(
    "command_create_manual_booking",
    expect.anything(),
  );
});

it.each([
  { label: "still busy", saveIndex: 0 },
  { label: "busy on a different date", saveIndex: 18 },
])(
  "blocks a series that is $label at save despite a preview override",
  async ({ saveIndex }) => {
    const previewSlot = windows[0];
    let slot = previewSlot;
    const provider = longSeries((query) =>
      free(
        query,
        slot.start >= query.timeMin && slot.end <= query.timeMax ? [slot] : [],
      ),
    );
    const preview = await previewSeries();
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      resource: { conflicts: [{ start: previewSlot.start, source: "google" }] },
    });
    slot = windows[saveIndex];
    const response = await call({ ...seriesPayload, allow_conflict: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "SLOT_UNAVAILABLE",
      message: expect.stringContaining(
        formatStudioDateTime(slot.start, seriesPayload.timezone),
      ),
    });
    expect(provider).toHaveBeenCalledTimes(18);
    expect(state.rpc.mock.calls.map(([name]) => name)).toEqual([
      "manual_booking_series_plan",
      "manual_booking_replay",
      "manual_booking_series_plan",
    ]);
  },
);

it("saves a conflict-free series and returns its committed receipt on duplicate submission", async () => {
  const provider = longSeries((query) => free(query));
  const created = await call(seriesPayload);
  expect(created.status).toBe(201);
  const receipt = await created.json();
  expect(receipt).toMatchObject({ lessonId: "first-lesson" });
  expect(provider).toHaveBeenCalledTimes(9);
  state.rpc.mockResolvedValueOnce({ data: receipt, error: null });

  const duplicate = await call(seriesPayload);
  expect(duplicate.status).toBe(201);
  expect(await duplicate.json()).toEqual(receipt);
  expect(provider).toHaveBeenCalledTimes(9);
  expect(state.rpc.mock.calls.map(([name]) => name)).toEqual([
    "manual_booking_replay",
    "manual_booking_series_plan",
    "command_create_manual_booking",
    "manual_booking_replay",
  ]);
});

it("preserves the explicit Google conflict override for an individual booking", async () => {
  state.configured = true;
  state.google.mockResolvedValue("synthetic-provider-token");
  state.conflict.mockResolvedValue([
    { id: "busy", summary: "Busy", ...windows[0] },
  ]);
  expect((await call()).status).toBe(409);
  const approved = { ...payload, allow_conflict: true };
  expect((await call(approved)).status).toBe(201);
  expect(state.conflict).toHaveBeenCalledTimes(1);
  expect(state.rpc).toHaveBeenLastCalledWith("command_create_manual_booking", {
    p_key: "e2e-stable-manual",
    p_value: approved,
    p_external_status: "overridden",
  });
});

it("retries a Google quota error once and returns an actionable failure when the retry is throttled", async () => {
  let affected = 0;
  const provider = longSeries((query) => {
    if (query.timeMax !== windows[51].end) return free(query);
    affected++;
    return Response.json(
      { error: { errors: [{ reason: "userRateLimitExceeded" }] } },
      { status: 403 },
    );
  });
  const response = await call(seriesPayload);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    retryable: true,
    message: expect.stringContaining("limiting availability checks"),
  });
  expect(affected).toBe(2);
  expect(provider).toHaveBeenCalledTimes(10);
  expect(state.rpc).not.toHaveBeenCalledWith(
    "command_create_manual_booking",
    expect.anything(),
  );
});

it("retries a timed-out read with a fresh request deadline", async () => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) =>
    timeout(ms === 3_000 ? 50 : ms),
  );
  const firstRangeSignals: AbortSignal[] = [];
  const provider = longSeries(async (query, signal) => {
    if (query.timeMin === windows[0].start) {
      firstRangeSignals.push(signal);
      if (firstRangeSignals.length === 1)
        await delay(5_000, undefined, { signal });
    }
    return free(query);
  });
  expect((await call(seriesPayload)).status).toBe(201);
  expect(provider).toHaveBeenCalledTimes(10);
  expect(firstRangeSignals).toHaveLength(2);
  expect(firstRangeSignals[0].aborted).toBe(true);
  expect(firstRangeSignals[0]).not.toBe(firstRangeSignals[1]);
});
