// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import {
  loadHistoricalSource,
  previewHistoricalReconciliation,
  saveHistoricalReview,
  loadHistoricalLesson,
  loadHistoricalHistory,
} from "./historicalCalendarReview";
import { historicalProposalSchema } from "../domain/historicalCalendarReview";
const f = vi.hoisted(() => ({ command: vi.fn(), single: vi.fn() }));
vi.mock("./bookingCommands", () => ({ studioCommand: f.command }));
vi.mock("../lib/supabase", () => ({
  supabase: {
    from: () => {
      const q = { select: () => q, eq: () => q, single: f.single };
      return q;
    },
  },
}));
const id = (n: number) =>
  `e8600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = {
  candidateId: id(1),
  studioId: id(2),
  calendarId: "original-calendar",
  eventId: "original-event",
  summary: "Original source",
  sourceStatus: "active",
  reasonCode: "event_detected",
  stamp: "a".repeat(64),
  observation: {
    startsAt: null,
    endsAt: null,
    startDate: "2020-01-01",
    endDate: "2020-01-02",
  },
  decision: null,
  priorSignals: [],
  linkedLessons: [],
  attendanceVerified: false,
  financialCoverageVerified: false,
  canonicalEffects: [],
};
const proposal = {
  action: "link" as const,
  studentId: id(3),
  lessonId: id(4),
  lessonVersion: 2,
  reason: "Coach reviewed original source",
};
const receipt = {
  resource: {
    candidateId: id(1),
    decisionId: id(5),
    lessonId: id(4),
    studentId: id(3),
    created: false,
    linked: true,
    recordedOutcome: "completed",
    attendanceVerified: false,
    financialCoverageVerified: false,
  },
  auditEventId: id(6),
  queuedSideEffects: [],
};
beforeEach(() => vi.resetAllMocks());
it("reads the exact source with the requested strict or reopening contract", async () => {
  f.command.mockResolvedValue({ resource: source });
  await loadHistoricalSource(id(1));
  await loadHistoricalSource(id(1), true);
  expect(f.command.mock.calls.map((c) => c[1].command)).toEqual([
    "preview_historical_calendar_reopening",
    "preview_historical_calendar_review",
  ]);
  f.command.mockResolvedValue({ resource: { ...source, candidateId: id(9) } });
  await expect(loadHistoricalSource(id(1))).rejects.toThrow(
    "another candidate",
  );
});
it("accepts equivalent JSON field order and rejects a changed preview proposal", async () => {
  const preview = {
    ...source,
    phase: "preview",
    proposal: {
      reason: proposal.reason,
      lessonVersion: 2,
      lessonId: id(4),
      studentId: id(3),
      action: "link",
    },
    student: { id: id(3), name: "Original", version: 1 },
    target: {
      id: id(4),
      version: 2,
      topic: "Original",
      startsAt: "2020-01-01T15:00Z",
      endsAt: "2020-01-01T16:00Z",
      status: "completed",
    },
    startsAt: "2020-01-01T15:00Z",
    endsAt: "2020-01-01T16:00Z",
    sourceDifference: false,
    sourceMatchCount: 1,
    intervalMatchCount: 1,
    sourceMatchExamples: [],
    intervalMatchExamples: [],
    examplesAreComplete: true,
    blockedReason: null,
    recordedOutcome: "completed",
    proposedCanonicalEffects: [],
  };
  f.command.mockResolvedValue({ resource: preview });
  await expect(
    previewHistoricalReconciliation(id(1), proposal),
  ).resolves.toMatchObject({ proposal });
  f.command.mockResolvedValue({
    resource: { ...preview, proposal: { ...proposal, studentId: id(8) } },
  });
  await expect(
    previewHistoricalReconciliation(id(1), proposal),
  ).rejects.toThrow("exact request");
});
it("retains caller-owned key/stamp/proposal and rejects wrong-owner or unexpected side-effect receipts", async () => {
  const request = {
    kind: "canonical" as const,
    candidateId: id(1),
    proposal,
    stamp: source.stamp,
    key: "original-request-key",
    actorId: "original-coach",
  };
  f.command.mockResolvedValue(receipt);
  await saveHistoricalReview(request);
  expect(f.command).toHaveBeenLastCalledWith(
    "integrations",
    expect.objectContaining({
      command: "historical_calendar_reconciliation",
      idempotencyKey: request.key,
      payload: { candidateId: id(1), proposal, stamp: source.stamp },
    }),
    "original-coach",
  );
  f.command.mockResolvedValue({
    ...receipt,
    resource: { ...receipt.resource, studentId: id(8) },
  });
  await expect(saveHistoricalReview(request)).rejects.toThrow(
    "original student",
  );
  f.command.mockResolvedValue({
    ...receipt,
    queuedSideEffects: ["notification"],
  });
  await expect(saveHistoricalReview(request)).rejects.toThrow();
});
it("cannot present source confirmation as attendance or a different decision", async () => {
  const value = {
    kind: "decision" as const,
    candidateId: id(1),
    key: "retained-decision-key",
    decision: {
      candidateId: id(1),
      action: "skip" as const,
      reason: "Explicit reason",
      stamp: source.stamp,
    },
  };
  f.command.mockResolvedValue({
    ...receipt,
    resource: {
      ...receipt.resource,
      attendanceVerified: true,
      disposition: "skipped",
    },
  });
  await expect(saveHistoricalReview(value)).rejects.toThrow();
  f.command.mockResolvedValue({
    ...receipt,
    resource: { ...receipt.resource, disposition: "not_lesson" },
  });
  await expect(saveHistoricalReview(value)).rejects.toThrow("does not match");
});
it("loads an exact selected lesson version using authenticated RLS reads and handles read errors", async () => {
  f.single.mockResolvedValue({
    data: {
      id: id(4),
      version: 2,
      topic: "Original",
      starts_at: "2020-01-01T15:00Z",
      ends_at: "2020-01-01T16:00Z",
      status: "completed",
    },
    error: null,
  });
  await expect(loadHistoricalLesson(id(4))).resolves.toMatchObject({
    id: id(4),
    version: 2,
    status: "completed",
  });
  f.single.mockResolvedValue({ data: null, error: Error("Denied") });
  await expect(loadHistoricalLesson(id(4))).rejects.toThrow("unavailable");
});
it("passes the history cursor and rejects a missing continuation instead of assuming complete history", async () => {
  f.command.mockResolvedValue({
    resource: { items: [], total: 26, hasMore: true, nextBeforeVersion: 2 },
  });
  await loadHistoricalHistory(id(1), 2);
  expect(f.command.mock.calls[0][1].payload).toEqual({
    candidateId: id(1),
    beforeVersion: 2,
  });
  f.command.mockResolvedValue({
    resource: { items: [], total: 26, hasMore: true, nextBeforeVersion: null },
  });
  await expect(loadHistoricalHistory(id(1))).rejects.toThrow();
});
it("the shared proposal contract rejects attendance, pricing and notification instructions", () => {
  for (const key of [
    "status",
    "markPaid",
    "priceMinor",
    "attendance",
    "sendNotification",
  ])
    expect(
      historicalProposalSchema.safeParse({ ...proposal, [key]: true }).success,
    ).toBe(false);
});
it("rejects a mixed-candidate retained decision before sending any command", async () => {
  await expect(
    saveHistoricalReview({
      kind: "decision",
      candidateId: id(1),
      key: "exact-retained-key",
      decision: {
        candidateId: id(2),
        stamp: source.stamp,
        action: "skip",
        reason: "Explicit source decision",
      },
    }),
  ).rejects.toThrow("No request was sent");
  expect(f.command).not.toHaveBeenCalled();
});
