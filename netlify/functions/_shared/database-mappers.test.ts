import { describe, expect, it } from "vitest";
import { mapAuditInsert, toDatabaseJson } from "./database-mappers";

describe("database boundary mappers", () => {
  it("normalizes undefined values before they reach JSON columns", () => {
    expect(toDatabaseJson(undefined)).toBeNull();
    expect(toDatabaseJson({ value: 1, omitted: undefined })).toEqual({
      value: 1,
    });
  });

  it("maps domain audit values to the generated insert contract", () => {
    expect(
      mapAuditInsert({
        studioId: "studio-1",
        entityType: "student",
        entityId: "student-1",
        action: "student.updated",
        reason: "Coach updated student",
        correlationId: "correlation-1",
        beforeState: { name: "Before" },
        afterState: { name: "After" },
      }),
    ).toEqual({
      studio_id: "studio-1",
      entity_type: "student",
      entity_id: "student-1",
      action: "student.updated",
      reason: "Coach updated student",
      correlation_id: "correlation-1",
      source: "studio_command",
      before_state: { name: "Before" },
      after_state: { name: "After" },
    });
  });
});
