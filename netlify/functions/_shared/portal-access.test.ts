import { describe, expect, it } from "vitest";
import { generateTemporaryPassword } from "./portal-access";

describe("portal invitation credentials", () => {
  it("generates strong, unique one-time passwords on the server", () => {
    const passwords = Array.from({ length: 32 }, () =>
      generateTemporaryPassword(),
    );
    expect(new Set(passwords)).toHaveLength(passwords.length);
    for (const password of passwords) {
      expect(password.length).toBeGreaterThanOrEqual(16);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
    }
  });
});
