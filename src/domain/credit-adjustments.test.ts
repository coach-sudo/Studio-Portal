import { describe, expect, it } from "vitest";
import { creditAdjustmentTarget } from "./credits";
const totals = { available: 3, reserved: 4, remaining: 7 };
describe("clear credit adjustment amounts", () => {
  it("adds credits while preserving existing reservations", () =>
    expect(creditAdjustmentTarget(totals, "add", 2)).toEqual({
      total: 9,
      available: 5,
      difference: 2,
    }));
  it("removes only unreserved credits", () => {
    expect(creditAdjustmentTarget(totals, "remove", 3)).toEqual({
      total: 4,
      available: 0,
      difference: -3,
    });
    expect(() => creditAdjustmentTarget(totals, "remove", 4)).toThrow(
      "only remove available",
    );
  });
  it("sets an available balance without asking the coach to add the reserved balance", () =>
    expect(creditAdjustmentTarget(totals, "set_available", 5)).toEqual({
      total: 9,
      available: 5,
      difference: 2,
    }));
  it("rejects lowering the total below existing reservations", () =>
    expect(() => creditAdjustmentTarget(totals, "set_total", 3)).toThrow(
      "reserved credits",
    ));
  it.each([NaN, -1, 1.5, 100001])(
    "rejects invalid credit amount %s",
    (amount) =>
      expect(() => creditAdjustmentTarget(totals, "add", amount)).toThrow(),
  );
});
