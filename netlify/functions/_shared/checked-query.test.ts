// @vitest-environment node
import { expect, it } from "vitest";
import { checkedAll, checkedQuery } from "./checked-query";
it("does not release control on failure while an already-started mutation is pending", async () => {
  let finish!: () => void,
    settled = false;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const work = checkedAll([
    Promise.reject(new Error("database unavailable")),
    pending,
  ]).catch(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(settled).toBe(false);
  finish();
  await work;
  expect(settled).toBe(true);
});
it("rejects resolved PostgREST errors rather than acknowledging the write", async () => {
  await expect(
    checkedQuery(Promise.resolve({ data: null, error: { code: "08006" } })),
  ).rejects.toEqual({ code: "08006" });
});
