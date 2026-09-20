import { describe, expect, it } from "vitest";
import {
  assertE2ENamespacedValue,
  assertE2ERunId,
  assertNonProductionE2EUrl,
  isProductionDeployContext,
} from "./e2eSafety";

describe("deployed E2E safety", () => {
  it.each([
    "https://portal.d-a-j.com",
    "https://www.portal.d-a-j.com/book",
    "https://preview.portal.d-a-j.com",
  ])("rejects known production hosts: %s", (url) => {
    expect(() => assertNonProductionE2EUrl(url)).toThrow(
      /never target production/i,
    );
  });

  it("allows dedicated preview hosts", () => {
    expect(
      assertNonProductionE2EUrl(
        "https://deploy-preview-13--coachd-staging.netlify.app",
      ).hostname,
    ).toBe("deploy-preview-13--coachd-staging.netlify.app");
  });

  it("accepts only bounded e2e run IDs and cleanup values", () => {
    expect(assertE2ERunId("e2e-pr13-1234")).toBe("e2e-pr13-1234");
    expect(() => assertE2ERunId("production")).toThrow(/e2e- namespace/i);
    expect(assertE2ENamespacedValue("e2e-material-123")).toBe(
      "e2e-material-123",
    );
    expect(() => assertE2ENamespacedValue("student-real")).toThrow(
      /non-E2E target/i,
    );
  });

  it("recognizes production deploy context", () => {
    expect(isProductionDeployContext("production")).toBe(true);
    expect(isProductionDeployContext("deploy-preview")).toBe(false);
  });
});
