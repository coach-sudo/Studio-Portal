import { describe, expect, it } from "vitest";
import { resolveAccountDisplayName } from "./repository";

describe("account display names", () => {
  it("uses the linked contact's saved name for guardian and support accounts", () => {
    expect(
      resolveAccountDisplayName(
        "guardian",
        "User",
        { full_name: "Student Name" },
        { full_name: "Dana Patterson" },
      ),
    ).toBe("Dana Patterson");
  });

  it("uses a student's preferred name ahead of generic account metadata", () => {
    expect(
      resolveAccountDisplayName("student", "User", {
        full_name: "Maya Kim",
        preferred_name: "Maya",
      }),
    ).toBe("Maya");
  });
});
