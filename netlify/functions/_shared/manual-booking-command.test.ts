// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  google: vi.fn(),
  conflict: vi.fn(),
  configured: false,
  coach: true,
}));
vi.mock("./supabase", () => ({
  userClient: () => ({
    rpc: state.rpc,
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const method of ["select", "eq", "limit"]) q[method] = () => q;
      q.single = async () => ({
        data:
          table === "memberships"
            ? state.coach
              ? { studio_id: "synthetic" }
              : null
            : { duration_minutes: 60 },
        error: null,
      });
      return q;
    },
  }),
  serviceClient: vi.fn(() => {
    throw Error("Canonical service writes are forbidden in this handler");
  }),
}));
vi.mock("./google", () => ({
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
) =>
  handler(
    new Request("https://example.test/api/v2/admin/booking/bookings", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ command: "create_manual", payload: value }),
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
