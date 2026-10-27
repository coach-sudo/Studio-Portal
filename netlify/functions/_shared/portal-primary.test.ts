import { afterEach, describe, expect, it, vi } from "vitest";
import {
  portalActionUrl,
  portalOrigin,
  resolvePortalOrigin,
} from "./portal-url";

vi.mock("./release", () => ({
  releaseMetadata: () => ({ context: "production", commit: "test" }),
}));

const stagingSite = "d83ff6cb-f57b-4741-8c3c-3eaae7adab19";
const stagingOrigin = "https://coachd-staging.netlify.app";

afterEach(() => vi.unstubAllGlobals());

describe("staging primary portal origin", () => {
  it("keeps every portal action on staging for its exact trusted site identity", () => {
    const origin = resolvePortalOrigin({
      context: "production",
      siteId: stagingSite,
      siteUrl: stagingOrigin,
      deployUrl: "https://portal.d-a-j.com",
      ephemeral: true,
      testUrl: "http://localhost:8888",
    });
    expect(origin).toBe(stagingOrigin);
    for (const action of [
      "lesson",
      "booking",
      "payments",
      "packages",
      "work",
      "actor",
      "login",
      "book",
    ] as const) {
      const url = new URL(portalActionUrl(origin, action, "synthetic-token"));
      expect(url.origin).toBe(stagingOrigin);
      expect(url.search).toBe("");
    }
  });

  it("rejects missing or mismatched staging identity and malformed site URLs", () => {
    for (const siteId of [
      undefined,
      "93829451-dbcf-4863-a07f-fa448cb17494",
      "other",
    ])
      expect(() =>
        resolvePortalOrigin({
          context: "production",
          siteId,
          siteUrl: stagingOrigin,
        }),
      ).toThrow();
    for (const siteUrl of [
      undefined,
      "http://coachd-staging.netlify.app",
      "https://user:password@coachd-staging.netlify.app",
      "https://coachd-staging.netlify.app:8443",
      "https://coachd-staging.netlify.app.attacker.example",
      "https://other-site.netlify.app",
      "https://portal.d-a-j.com",
      "https://portal.daj.com",
      "https://studio-portal.netlify.app",
      `${stagingOrigin}/book`,
      `${stagingOrigin}/?redirect=production`,
      `${stagingOrigin}/#production`,
    ])
      expect(() =>
        resolvePortalOrigin({
          context: "production",
          siteId: stagingSite,
          siteUrl,
        }),
      ).toThrow();
  });

  it("reads the platform site identity at the actual runtime boundary", () => {
    const values: Record<string, string> = {
      SITE_ID: stagingSite,
      URL: stagingOrigin,
    };
    vi.stubGlobal("Netlify", { env: { get: (key: string) => values[key] } });
    expect(portalOrigin()).toBe(stagingOrigin);
  });
});
