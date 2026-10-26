// @vitest-environment node
import { expect, it, vi } from "vitest";
import { packageLedgers, publishedLessonIds } from "./maintenance-reads";
import type { SupabaseClient } from "@supabase/supabase-js";
function fixture(rows: Record<string, unknown>[], error: unknown = null) {
  const ranges: number[] = [];
  const q = {
    select: () => q,
    in: () => q,
    eq: () => q,
    order: () => q,
    range: vi.fn(async (from: number, to: number) => {
      ranges.push(from);
      return { data: rows.slice(from, to + 1), error };
    }),
  };
  return { db: { from: () => q } as unknown as SupabaseClient, q, ranges };
}
it("replaces per-package reads with a bounded batch and preserves every ledger page", async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({
    id: String(i),
    package_id: "package",
    kind: i === 1000 ? "purchase" : "reservation",
    quantity: i === 1000 ? 1000 : -1,
    created_at: `2031-01-${i === 1000 ? "02" : "01"}`,
  }));
  const f = fixture(rows),
    result = await packageLedgers(f.db, ["package"]);
  expect(f.ranges).toEqual([0, 1000]);
  expect(result.get("package")).toHaveLength(1001);
  expect(result.get("package")?.reduce((n, r) => n + r.quantity, 0)).toBe(0);
  expect(result.get("package")?.[0].kind).toBe("purchase");
});
it("batches 100 package reads into one request without financial mutations", async () => {
  const f = fixture([]);
  await packageLedgers(
    f.db,
    Array.from({ length: 100 }, (_, i) => `package-${i}`),
  );
  expect(f.q.range).toHaveBeenCalledOnce();
});
it("fails closed when a ledger or published-note read is unavailable", async () => {
  const f = fixture([], { code: "08006" });
  await expect(packageLedgers(f.db, ["package"])).rejects.toEqual({
    code: "08006",
  });
  await expect(publishedLessonIds(f.db, ["lesson"])).rejects.toEqual({
    code: "08006",
  });
});
it("finds published notes on later pages", async () => {
  const f = fixture(
    Array.from({ length: 1001 }, (_, i) => ({
      id: String(i),
      lesson_id: i === 1000 ? "last" : "first",
    })),
  );
  expect(await publishedLessonIds(f.db, ["first", "last"])).toEqual(
    new Set(["first", "last"]),
  );
});
