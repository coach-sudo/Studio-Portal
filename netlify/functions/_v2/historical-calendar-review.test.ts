// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { calendarSourceObservation } from "../_shared/calendar-source-protection";
import { handleHistoricalCalendarReview } from "./historical-calendar-review";
import type { V2CommandContext } from "./types";
const f = vi.hoisted(() => ({ rpc: vi.fn(), coach: vi.fn() }));
const candidateId = "e8400000-0000-4000-8000-000000000010";
const payload = {
  candidateId,
  action: "skip",
  reason: "Explicit coach decision",
  stamp: "a".repeat(64),
};
function ctx(command = "historical_calendar_review", value: unknown = payload) {
  return {
    domain: "integrations",
    input: {
      command,
      payload: value,
      idempotencyKey: "synthetic-review-stable",
    },
    requireCoach: f.coach,
    db: { rpc: f.rpc },
  } as unknown as V2CommandContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  f.coach.mockResolvedValue("e8400000-0000-4000-8000-000000000001");
  f.rpc.mockResolvedValue({
    data: { resource: { disposition: "skipped" }, queuedSideEffects: [] },
    error: null,
  });
});
it("uses the authenticated RPC and stable identity without reading provider credentials", async () => {
  const response = await handleHistoricalCalendarReview(ctx());
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
    "command_historical_calendar_review",
    {
      p_candidate: candidateId,
      p_payload: {
        action: payload.action,
        reason: payload.reason,
        stamp: payload.stamp,
      },
      p_key: "synthetic-review-stable",
    },
  );
  expect(await response!.json()).toEqual({
    resource: { disposition: "skipped" },
    queuedSideEffects: [],
  });
});
it("previews one exact authorized candidate without a worker invocation", async () => {
  await handleHistoricalCalendarReview(
    ctx("preview_historical_calendar_review", { candidateId }),
  );
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
    "preview_historical_calendar_review",
    { p_candidate: candidateId },
  );
});
it("rejects a non-coach before the RPC", async () => {
  f.coach.mockRejectedValue(new Error("FORBIDDEN"));
  await expect(handleHistoricalCalendarReview(ctx())).rejects.toThrow(
    "FORBIDDEN",
  );
  expect(f.rpc).not.toHaveBeenCalled();
});
it("does not handle another domain or command", async () => {
  expect(
    await handleHistoricalCalendarReview({ ...ctx(), domain: "lessons" }),
  ).toBeNull();
  expect(await handleHistoricalCalendarReview(ctx("review_import"))).toBeNull();
  expect(f.coach).not.toHaveBeenCalled();
});
it.each([
  { action: "create" },
  { action: "link" },
  { stamp: "stale" },
  { reason: "  " },
  { action: "skip", legacyImportId: candidateId },
  { action: "reopen", legacyImportId: candidateId },
  { action: "reopen", legacyUpdatedAt: "2020-01-01T00:00:00Z" },
  { acknowledgeUnscoped: true },
  { providerPayload: { private: "excluded" } },
])("rejects invalid or unsupported command fields %j", async (patch) => {
  await expect(
    handleHistoricalCalendarReview(
      ctx("historical_calendar_review", { ...payload, ...patch }),
    ),
  ).rejects.toThrow();
  expect(f.rpc).not.toHaveBeenCalled();
});
it("sends exactly one explicit ignored signal and unscoped acknowledgement", async () => {
  await handleHistoricalCalendarReview(
    ctx("historical_calendar_review", {
      ...payload,
      action: "reopen",
      legacyImportId: candidateId,
      legacyUpdatedAt: "2020-01-01T00:00:00Z",
      acknowledgeUnscoped: true,
    }),
  );
  expect(f.rpc.mock.calls[0][1].p_payload.legacyImportId).toBe(candidateId);
  expect(f.rpc.mock.calls[0][1].p_payload.acknowledgeUnscoped).toBe(true);
});
it("propagates a stale preview failure without a misleading success", async () => {
  f.rpc.mockResolvedValue({ data: null, error: Error("VERSION_CONFLICT") });
  await expect(handleHistoricalCalendarReview(ctx())).rejects.toThrow(
    "VERSION_CONFLICT",
  );
  expect(f.rpc).toHaveBeenCalledTimes(1);
});
it("uses the same UTC precision for equivalent provider offsets and preview stamps", () => {
  const a = calendarSourceObservation({
    id: "source",
    start: { dateTime: "2020-01-01T10:00:00-05:00" },
    end: { dateTime: "2020-01-01T11:00:00-05:00" },
  });
  const b = calendarSourceObservation({
    id: "source",
    start: { dateTime: "2020-01-01T15:00:00.000Z" },
    end: { dateTime: "2020-01-01T16:00:00Z" },
  });
  expect(a).toEqual(b);
  expect(a.startsAt).toBe("2020-01-01T15:00:00.000Z");
});
it.each(["2020-02-30T15:00:00Z", "2020-01-01T15:00:00", "invalid"])(
  "invalid source time %s cannot produce a historical instant",
  (dateTime) => {
    const value = calendarSourceObservation({
      id: "source",
      start: { dateTime },
      end: { dateTime: "2020-03-01T16:00:00Z" },
    });
    expect(value.startsAt).toBeNull();
    expect(value.endsAt).toBeNull();
  },
);
