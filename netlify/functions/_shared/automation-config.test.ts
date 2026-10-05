import { describe, expect, it } from "vitest";
import { automationConfigSchema } from "./automation-config";
const value = {
  enabled: true,
  mode: "draft",
  timing: { hoursBefore: [72, 24, 2] },
  escalation: { coach: false },
  template: { subject: "A note from your coach" },
};
describe("constrained automation configuration boundary", () => {
  it("accepts the four supported modes without permitting arbitrary destinations or recipients", () => {
    for (const mode of [
      "off",
      "draft",
      "automatic",
      "automatic_with_escalation",
    ])
      expect(automationConfigSchema.safeParse({ ...value, mode }).success).toBe(
        true,
      );
    for (const extra of [
      { recipient: "attacker@example.test" },
      { template: { url: "https://attacker.example.test" } },
      { mode: "custom_script" },
    ])
      expect(
        automationConfigSchema.safeParse({ ...value, ...extra }).success,
      ).toBe(false);
  });
  it.each([
    { hoursBefore: [-1] },
    { hoursBefore: Array(7).fill(24) },
    { daysBefore: 366 },
    { lowThreshold: 101 },
  ])("rejects unsafe or unbounded timing %j", (timing) => {
    expect(automationConfigSchema.safeParse({ ...value, timing }).success).toBe(
      false,
    );
  });
});
