import { describe, it, expect } from "vitest";
import { studentSetupSchema } from "./studentSetup";
describe("setup intent validation", () => {
  it("allows an empty skippable setup draft", () =>
    expect(studentSetupSchema.parse({ step: 5, actions: [] })).toEqual({
      step: 5,
      actions: [],
    }));
  it("refuses arbitrary domain commands and invalid lesson intervals", () => {
    expect(
      studentSetupSchema.safeParse({
        step: 0,
        actions: [{ id: crypto.randomUUID(), kind: "reconcile", payload: {} }],
      }).success,
    ).toBe(false);
    expect(
      studentSetupSchema.safeParse({
        step: 2,
        actions: [
          {
            id: crypto.randomUUID(),
            kind: "lesson",
            payload: {
              topic: "Lesson",
              startsAt: "2030-01-01T11:00:00Z",
              endsAt: "2030-01-01T10:00:00Z",
              recurrence: "none",
              occurrenceCount: 1,
              timezone: "UTC",
              locationType: "in_person",
              locationLabel: "",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
