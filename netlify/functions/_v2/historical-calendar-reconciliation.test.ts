// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { handleHistoricalCalendarReconciliation } from "./historical-calendar-reconciliation";
import type { V2CommandContext } from "./types";
const f = vi.hoisted(() => ({ rpc: vi.fn(), coach: vi.fn() }));
const candidateId = "e8600000-0000-4000-8000-000000000010",
  studentId = "e8600000-0000-4000-8000-000000000006",
  lessonId = "e8600000-0000-4000-8000-000000000030";
const proposal = {
  action: "create",
  studentId,
  reason: "Explicit historical record",
  startsAt: "2020-01-01T15:00:00Z",
  endsAt: "2020-01-01T16:00:00Z",
  timezone: "UTC",
  topic: "Recorded historical coaching",
  locationType: "in_person",
  locationLabel: "Studio",
};
const value = { candidateId, proposal, stamp: "a".repeat(64) };
function ctx(
  command = "historical_calendar_reconciliation",
  payload: unknown = value,
) {
  return {
    domain: "integrations",
    input: { command, payload, idempotencyKey: "synthetic-canonical-stable" },
    requireCoach: f.coach,
    db: { rpc: f.rpc },
  } as unknown as V2CommandContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  f.coach.mockResolvedValue("studio");
  f.rpc.mockResolvedValue({
    data: {
      resource: {
        created: true,
        lessonId,
        attendanceVerified: false,
        financialCoverageVerified: false,
      },
      queuedSideEffects: [],
    },
    error: null,
  });
});
it("sends an authenticated exact request/stamp/key and reports the committed receipt", async () => {
  const response = await handleHistoricalCalendarReconciliation(ctx());
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
    "command_historical_calendar_reconciliation",
    {
      p_candidate: candidateId,
      p_value: proposal,
      p_stamp: value.stamp,
      p_key: "synthetic-canonical-stable",
    },
  );
  expect(await response!.json()).toMatchObject({
    resource: {
      created: true,
      attendanceVerified: false,
      financialCoverageVerified: false,
    },
    queuedSideEffects: [],
  });
});
it("keeps preview separate from canonical execution", async () => {
  const response = await handleHistoricalCalendarReconciliation(
    ctx("preview_historical_calendar_reconciliation", {
      candidateId,
      proposal,
    }),
  );
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
    "preview_historical_calendar_reconciliation",
    { p_candidate: candidateId, p_value: proposal },
  );
  expect(await response!.json()).toMatchObject({ processing: "preview" });
});
it("links only an explicitly selected canonical version", async () => {
  const link = {
    action: "link",
    studentId,
    lessonId,
    lessonVersion: 7,
    reason: "Coach verified existing history",
  };
  await handleHistoricalCalendarReconciliation(
    ctx("historical_calendar_reconciliation", { ...value, proposal: link }),
  );
  expect(f.rpc.mock.calls[0][1].p_value).toEqual(link);
});
it("can preview explicit reopening without requiring a fabricated source time", async () => {
  const response = await handleHistoricalCalendarReconciliation(
    ctx("preview_historical_calendar_reopening", { candidateId }),
  );
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
    "preview_historical_calendar_reopening",
    { p_candidate: candidateId },
  );
  expect(await response!.json()).toMatchObject({
    processing: "reopen_preview",
  });
});
it("reads bounded version history through the authenticated source context", async () => {
  await handleHistoricalCalendarReconciliation(
    ctx("historical_calendar_decision_history", {
      candidateId,
      beforeVersion: 6,
    }),
  );
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
    "historical_calendar_decision_history",
    { p_candidate: candidateId, p_before_version: 6 },
  );
});
it("rejects non-coaches before reading a candidate or receipt", async () => {
  f.coach.mockRejectedValue(Error("FORBIDDEN"));
  await expect(handleHistoricalCalendarReconciliation(ctx())).rejects.toThrow(
    "FORBIDDEN",
  );
  expect(f.rpc).not.toHaveBeenCalled();
});
it.each([
  { status: "completed" },
  { paidMinor: 5000 },
  { paymentStatus: "paid" },
  { attendanceVerified: true },
  { notifyStudents: true },
  { allowConflict: true },
  { timezone: "invalid/timezone" },
  { endsAt: "2020-01-01T14:00:00Z" },
  { startsAt: "2020-01-01T15:00:00" },
  { reason: " " },
  { studentId: "wrong" },
])(
  "rejects unsupported implicit effects or malformed proposal %j",
  async (patch) => {
    await expect(
      handleHistoricalCalendarReconciliation(
        ctx("historical_calendar_reconciliation", {
          ...value,
          proposal: { ...proposal, ...patch },
        }),
      ),
    ).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();
  },
);
it("does not acknowledge a stale/database failure as success or retry a changed request", async () => {
  f.rpc.mockResolvedValue({ data: null, error: Error("VERSION_CONFLICT") });
  await expect(handleHistoricalCalendarReconciliation(ctx())).rejects.toThrow(
    "VERSION_CONFLICT",
  );
  expect(f.rpc).toHaveBeenCalledTimes(1);
});
it("does not intercept unrelated commands or domains", async () => {
  expect(
    await handleHistoricalCalendarReconciliation(ctx("review_import")),
  ).toBeNull();
  expect(
    await handleHistoricalCalendarReconciliation({
      ...ctx(),
      domain: "lessons",
    }),
  ).toBeNull();
  expect(f.coach).not.toHaveBeenCalled();
});
