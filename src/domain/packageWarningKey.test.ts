import { describe, expect, it } from "vitest";
import type { CreditEntry, PackageAccount } from "./model";
import { packageWarningKey } from "./packageWarningKey";
const pkg = {
  id: "package",
  studentId: "student",
  expiresAt: "2026-11-01T12:00:00Z",
} as PackageAccount;
const purchase = {
  id: "purchase",
  packageId: "package",
  kind: "purchase",
  quantity: 5,
  createdAt: "2026-10-01T12:00:00Z",
} as CreditEntry;
describe("shared package warning idempotency", () => {
  it("matches maintenance low-balance keys and ignores unrelated credits", () => {
    expect(
      packageWarningKey(
        pkg,
        [
          purchase,
          { ...purchase, id: "used", kind: "consumption", quantity: -4 },
          { ...purchase, packageId: "other", quantity: 10 },
        ],
        "package_low",
        Date.now(),
      ),
    ).toBe("package:package:purchase:purchase:low:1");
  });
  it("changes only when the credit/replenishment state changes", () => {
    expect(
      packageWarningKey(
        pkg,
        [
          purchase,
          {
            ...purchase,
            id: "renew",
            quantity: 3,
            createdAt: "2026-10-02T12:00:00Z",
          },
        ],
        "package_low",
        Date.now(),
      ),
    ).toBe("package:package:purchase:renew:low:8");
  });
  it("preserves the established 30/14/7-day expiration warning stages", () => {
    for (const [days, stage] of [
      [20, 30],
      [10, 14],
      [3, 7],
    ])
      expect(
        packageWarningKey(
          pkg,
          [purchase],
          "package_expiration",
          Date.parse(pkg.expiresAt!) - days * 86400000,
        ),
      ).toBe(`package:package:expiry:${stage}:student`);
  });
});
