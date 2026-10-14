import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { applyAutomaticCredits } from "./auto-credits";
const first = "20000000-0000-4000-8000-000000000001",
  second = "20000000-0000-4000-8000-000000000002";
const result = {
  processed: true,
  applied: 2,
  alreadyCovered: 3,
  skipped: 1,
  failed: 0,
  skipReasons: { payment_pending: 1 },
  failureCodes: {},
  autoApplyPending: false,
};
function fixture(responses: Record<string, unknown> = {}) {
  const rpc = vi.fn(async (name: string, args: { p_student?: string }) => {
    if (name === "credit_coverage_work")
      return { data: [first, second], error: null };
    if (name === "defer_credit_coverage_job")
      return { data: null, error: null };
    const data = responses[args.p_student!] ?? result;
    if (data instanceof Error) throw data;
    return { data, error: null };
  });
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}
it("reports transactional counts without unlocked balance comparisons", async () => {
  const f = fixture();
  expect(await applyAutomaticCredits(f.db)).toMatchObject({
    applied: 4,
    alreadyCovered: 6,
    skipped: 2,
    failed: 0,
    accountsProcessed: 2,
  });
  expect(f.rpc).toHaveBeenCalledWith("credit_coverage_work", { p_limit: 25 });
  expect(f.rpc).not.toHaveBeenCalledWith(
    "student_credit_summary",
    expect.anything(),
  );
});
it("isolates a transport failure and persists backoff while processing the next account", async () => {
  const f = fixture({ [first]: new Error("database unavailable") });
  expect(await applyAutomaticCredits(f.db)).toMatchObject({
    applied: 2,
    failed: 1,
    pending: 1,
    accountsProcessed: 1,
    failures: [{ studentId: first, code: "account_unavailable" }],
  });
  expect(f.rpc).toHaveBeenCalledWith("defer_credit_coverage_job", {
    p_student: first,
  });
});
it("retains SQL failures separately from skips and reports completed-job replays honestly", async () => {
  const f = fixture({
    [first]: {
      ...result,
      applied: 0,
      failed: 1,
      failureCodes: { P0001: 1 },
      autoApplyPending: true,
    },
    [second]: { processed: false },
  });
  expect(await applyAutomaticCredits(f.db)).toMatchObject({
    applied: 0,
    alreadyCovered: 3,
    skipped: 1,
    failed: 1,
    pending: 1,
    accountsProcessed: 1,
  });
});
it("rejects malformed counts without aborting other accounts", async () => {
  const f = fixture({ [first]: { ...result, skipped: 99 } });
  expect(await applyAutomaticCredits(f.db)).toMatchObject({
    applied: 2,
    failed: 1,
    accountsProcessed: 1,
  });
});
it("returns an observable maintenance failure when the bounded work query fails", async () => {
  const f = fixture();
  f.rpc.mockRejectedValueOnce(new Error("network"));
  // Network rejections at the work boundary are caught as well as Supabase error results.
  expect(await applyAutomaticCredits(f.db)).toMatchObject({
    failed: 1,
    accountsProcessed: 0,
    failures: [{ studentId: null, code: "work_unavailable" }],
  });
});
