import { describe, expect, it } from "vitest";
import { mapStudentChanges } from "../../netlify/functions/_shared/student-updates";

const columns = { goals: "goals", privateNotes: "internal_notes", timezone: "timezone", email: "email", preferredName: "preferred_name" };

describe("student update mapping", () => {
  it("keeps required text fields as empty strings", () => {
    expect(mapStudentChanges(
      { goals: "   ", privateNotes: "", timezone: " America/New_York " },
      Object.keys(columns),
      columns,
    )).toEqual({ goals: "", internal_notes: "", timezone: "America/New_York" });
  });

  it("normalizes blank optional contact fields to null", () => {
    expect(mapStudentChanges(
      { email: "  ", preferredName: " Darius " },
      Object.keys(columns),
      columns,
    )).toEqual({ email: null, preferred_name: "Darius" });
  });
});
