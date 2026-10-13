import type { SupabaseClient } from "@supabase/supabase-js";

/** Scan enabled accounts rather than a fixed lesson horizon, so later lessons are not starved. */
export async function applyAutomaticCredits(db: SupabaseClient) {
  let applied = 0;
  for (let offset = 0; ; offset += 100) {
    const accounts = await db
      .from("student_credit_accounts")
      .select("student_id,students!inner(deleted_at)")
      .eq("auto_apply", true)
      .is("students.deleted_at", null)
      .order("student_id")
      .range(offset, offset + 99);
    if (accounts.error) throw accounts.error;
    for (const account of accounts.data ?? []) {
      const before = await db.rpc("student_credit_summary", {
        p_student: account.student_id,
      });
      if (before.error) throw before.error;
      if (before.data.needsReview || before.data.available <= 0) continue;
      const result = await db.rpc("reserve_student_upcoming_credits", {
        p_student: account.student_id,
      });
      if (result.error) throw result.error;
      applied += Math.max(
        0,
        Number(before.data.available) - Number(result.data.available),
      );
    }
    if ((accounts.data?.length ?? 0) < 100) return applied;
  }
}
