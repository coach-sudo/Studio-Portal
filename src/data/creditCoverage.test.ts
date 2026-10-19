import { beforeEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));
import { loadCreditCoverage } from "./creditCoverage";

const studentId = "73000000-0000-4000-8000-000000000001";
function fixture() {
  return {
    studentId,
    evaluatedAt: "2026-10-14T12:00:00Z",
    previewEnable: false,
    settingReasonCode: null,
    lessonsVisible: true,
    summary: {
      available: 2,
      reserved: 0,
      remaining: 2,
      expired: 0,
      version: 1,
      autoApply: false,
      needsReview: false,
    },
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
    hasMore: false,
    counts: { covered: 0, eligible: 0, uncovered: 0, reviewRequired: 0 },
  };
}
beforeEach(() => vi.resetAllMocks());

it("loads bounded default diagnostics through the guarded read RPC", async () => {
  rpc.mockResolvedValue({ data: fixture(), error: null });
  expect(await loadCreditCoverage({ studentId })).toEqual(fixture());
  expect(rpc).toHaveBeenCalledWith("student_credit_coverage", {
    p_student: studentId,
    p_page: 1,
    p_page_size: 25,
    p_preview_enable: false,
  });
});
it("propagates cancellation and explicitly requests a read-only enable preview", async () => {
  const abortSignal = vi.fn().mockResolvedValue({
    data: { ...fixture(), previewEnable: true },
    error: null,
  });
  rpc.mockReturnValue({ abortSignal });
  const signal = new AbortController().signal;
  expect(
    (await loadCreditCoverage({ studentId, previewEnable: true }, signal))
      .previewEnable,
  ).toBe(true);
  expect(abortSignal).toHaveBeenCalledWith(signal);
});
it("rejects unsafe paging before sending a request", async () => {
  await expect(
    loadCreditCoverage({ studentId, pageSize: 101 }),
  ).rejects.toThrow();
  await expect(loadCreditCoverage({ studentId, page: 0 })).rejects.toThrow();
  await expect(
    loadCreditCoverage({ studentId: "not-a-uuid" }),
  ).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
it("does not reinterpret denied or failed reads as empty coverage", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });
  await expect(loadCreditCoverage({ studentId })).rejects.toThrow("FORBIDDEN");
});
it("fails closed for malformed financial or eligibility responses", async () => {
  rpc.mockResolvedValue({
    data: { ...fixture(), summary: { ...fixture().summary, autoApply: "On" } },
    error: null,
  });
  await expect(loadCreditCoverage({ studentId })).rejects.toThrow();
  rpc.mockResolvedValue({
    data: { ...fixture(), counts: { ...fixture().counts, eligible: -1 } },
    error: null,
  });
  await expect(loadCreditCoverage({ studentId })).rejects.toThrow();
});
it("retains unknown logistics and mixed legacy preferences explicitly", async () => {
  const result = {
    ...fixture(),
    lessonsVisible: false,
    counts: null,
    total: null,
    settingReasonCode: "mixed_settings_review",
    summary: { ...fixture().summary, autoApply: null },
  };
  rpc.mockResolvedValue({ data: result, error: null });
  expect(await loadCreditCoverage({ studentId })).toEqual(result);
});

it("rejects a different student's response and inconsistent account totals", async () => {
  rpc.mockResolvedValue({
    data: { ...fixture(), studentId: "73000000-0000-4000-8000-000000000002" },
    error: null,
  });
  await expect(loadCreditCoverage({ studentId })).rejects.toThrow(
    "does not match",
  );
  rpc.mockResolvedValue({
    data: { ...fixture(), summary: { ...fixture().summary, remaining: 100 } },
    error: null,
  });
  await expect(loadCreditCoverage({ studentId })).rejects.toThrow(
    "do not reconcile",
  );
});

it("rejects fabricated zero counts for a finance-only reader", async () => {
  rpc.mockResolvedValue({
    data: { ...fixture(), lessonsVisible: false },
    error: null,
  });
  await expect(loadCreditCoverage({ studentId })).rejects.toThrow(
    "Hidden logistics",
  );
});
