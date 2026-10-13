import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { applyAutomaticCredits } from "./auto-credits";
function fixture(
  pages: { student_id: string }[][],
  balances: Record<string, { available: number; needsReview?: boolean }>,
) {
  const eq = vi.fn();
  const range = vi
    .fn()
    .mockImplementation((start: number) =>
      Promise.resolve({ data: pages[start / 100] ?? [], error: null }),
    );
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => {
      eq(...args);
      return query;
    },
    is: () => query,
    order: () => query,
    range,
  };
  const rpc = vi
    .fn()
    .mockImplementation(
      async (name: string, { p_student }: { p_student: string }) => ({
        data:
          name === "student_credit_summary"
            ? balances[p_student]
            : { available: 0 },
        error: null,
      }),
    );
  return {
    db: { from: () => query, rpc } as unknown as SupabaseClient,
    rpc,
    range,
    eq,
  };
}
it("uses the full upcoming account scan, without a 45-day lesson cutoff", async () => {
  const f = fixture([[{ student_id: "student" }]], {
    student: { available: 3 },
  });
  expect(await applyAutomaticCredits(f.db)).toBe(3);
  expect(f.eq).toHaveBeenCalledWith("auto_apply", true);
  expect(f.rpc).toHaveBeenCalledWith("reserve_student_upcoming_credits", {
    p_student: "student",
  });
});
it("preserves accounts that need reconciliation and accounts without available credits", async () => {
  const f = fixture([[{ student_id: "review" }, { student_id: "empty" }]], {
    review: { available: 4, needsReview: true },
    empty: { available: 0 },
  });
  expect(await applyAutomaticCredits(f.db)).toBe(0);
  expect(
    f.rpc.mock.calls.filter(
      ([name]) => name === "reserve_student_upcoming_credits",
    ),
  ).toHaveLength(0);
});
it("paginates accounts so the first 100 cannot starve later students", async () => {
  const first = Array.from({ length: 100 }, (_, n) => ({
    student_id: `s${n}`,
  }));
  const balances = Object.fromEntries(
    first.map(({ student_id }) => [student_id, { available: 0 }]),
  );
  const f = fixture([first, [{ student_id: "last" }]], {
    ...balances,
    last: { available: 2 },
  });
  expect(await applyAutomaticCredits(f.db)).toBe(2);
  expect(f.range).toHaveBeenCalledWith(100, 199);
});
