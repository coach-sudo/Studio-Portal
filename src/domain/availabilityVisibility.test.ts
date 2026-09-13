import { describe, expect, it } from "vitest";
import { slotIsVisible, visibleSlotsPercent } from "./availabilityVisibility";

describe("public slot visibility", () => {
  const starts = Array.from({ length: 240 }, (_, index) => new Date(Date.UTC(2030, 0, 1, index)).toISOString());

  it("keeps all slots visible by default and rejects unsupported settings", () => {
    expect(visibleSlotsPercent(undefined)).toBe(100);
    expect(visibleSlotsPercent(50)).toBe(100);
    expect(starts.every((start) => slotIsVisible("service", start, 100))).toBe(true);
  });

  it("holds back a stable share of slots at 90% or 75%", () => {
    const count = (percent: 90 | 75) => starts.filter((start) => slotIsVisible("service", start, percent)).length;
    expect(count(90)).toBeGreaterThan(190);
    expect(count(90)).toBeLessThan(235);
    expect(count(75)).toBeGreaterThan(150);
    expect(count(75)).toBeLessThan(205);
    expect(slotIsVisible("service", starts[0], 75)).toBe(slotIsVisible("service", starts[0], 75));
  });
});
