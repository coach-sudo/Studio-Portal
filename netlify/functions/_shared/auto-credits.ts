import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { creditApplicationResultSchema } from "../../../src/domain/creditCoverage";

/** Each RPC commits one account. The database retains pending jobs and sweep progress. */
export async function applyAutomaticCredits(db: SupabaseClient) {
  const totals = {
    applied: 0,
    alreadyCovered: 0,
    skipped: 0,
    failed: 0,
    accountsProcessed: 0,
    pending: 0,
    failures: [] as { studentId: string | null; code: string }[],
  };
  const work = await (async () => {
    try {
      return await db.rpc("credit_coverage_work", { p_limit: 25 });
    } catch {
      return { data: null, error: true };
    }
  })();
  const ids = z.array(z.string().uuid()).max(25).safeParse(work.data);
  if (work.error || !ids.success) {
    totals.failed = 1;
    totals.failures.push({ studentId: null, code: "work_unavailable" });
    return totals;
  }
  for (const studentId of ids.data) {
    try {
      const response = await db.rpc("process_credit_coverage_job", {
        p_student: studentId,
      });
      if (response.error) throw response.error;
      if (response.data?.processed === false) continue;
      const result = creditApplicationResultSchema.parse(response.data);
      totals.accountsProcessed++;
      totals.applied += result.applied;
      totals.alreadyCovered += result.alreadyCovered;
      totals.skipped += result.skipped;
      totals.failed += result.failed;
      if (result.autoApplyPending) {
        totals.pending++;
        totals.failures.push({ studentId, code: "coverage_pending" });
      }
    } catch {
      // A transport/validation error leaves this database job pending for the next run.
      try {
        await db.rpc("defer_credit_coverage_job", { p_student: studentId });
      } catch {
        // An unavailable database cannot persist backoff; the original intent is retained.
      }
      totals.failed++;
      totals.pending++;
      totals.failures.push({ studentId, code: "account_unavailable" });
    }
  }
  return totals;
}
