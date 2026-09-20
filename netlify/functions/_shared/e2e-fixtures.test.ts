import { describe, expect, it } from "vitest";
import { fixtureCredentials, fixtureId } from "../e2e-fixtures";

describe("E2E fixture contracts", () => {
  it("derives stable UUIDs from a namespaced run", () => {
    expect(fixtureId("e2e-run-1234", "student")).toBe(
      fixtureId("e2e-run-1234", "student"),
    );
    expect(fixtureId("e2e-run-1234", "student")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("returns ordinary role credentials without the fixture or service secret", () => {
    const secret = "e2e-service-role-secret-must-not-leak";
    const result = fixtureCredentials("e2e-run-1234", secret);
    expect(Object.keys(result)).toEqual([
      "coach",
      "student",
      "guardian",
      "unrelated",
    ]);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toMatch(/service[_-]?role/i);
    expect(
      Object.values(result).every((account) => account.password.length >= 20),
    ).toBe(true);
  });
});

