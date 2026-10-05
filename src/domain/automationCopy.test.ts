import { describe, expect, it } from "vitest";
import { automationInstruction } from "./automationCopy";

describe("automation instructions", () => {
  it("makes the near-lesson request stronger without inventing cancellation or charges", () => {
    const near = automationInstruction("payment_due", "hours-2", false);
    expect(near).toContain("lesson is approaching");
    expect(near).toContain("contact your coach");
    expect(near).not.toMatch(/cancel|penalty|charge/i);
    expect(automationInstruction("payment_due", "hours-24", false)).not.toBe(
      near,
    );
  });
  it("keeps coach escalation and completed-lesson arrears context distinct", () => {
    expect(automationInstruction("payment_due", "hours-1", true)).toContain(
      "coach workspace",
    );
    expect(
      automationInstruction("payment_past_due", "past-due", false),
    ).not.toContain("lesson is approaching");
  });
});
