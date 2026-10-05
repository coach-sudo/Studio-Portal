import { describe, expect, it } from "vitest";
import { resolvePortalOrigin, portalActionUrl } from "./portal-url";
import { renderStudioEmail } from "./email-presentation";

describe("trusted email origins", () => {
  it("uses the real production origin even with a legacy configured URL", () => {
    expect(
      resolvePortalOrigin({
        context: "production",
        siteUrl: "https://portal.daj.com",
      }),
    ).toBe("https://portal.d-a-j.com");
  });
  it("uses the supplied preview deployment without leaking production links", () => {
    const origin = resolvePortalOrigin({
      context: "deploy-preview",
      deployPrimeUrl: "https://deploy-preview-26--coachd-staging.netlify.app",
    });
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
      const url = portalActionUrl(origin, action, "fixture-token");
      expect(url).toContain("deploy-preview-26--coachd-staging.netlify.app");
      expect(url).not.toMatch(/portal\.d(?:-a-j|aj)\.com/);
      expect(new URL(url).search).toBe("");
    }
  });
  it("uses a loopback origin only for the isolated ephemeral stack", () => {
    expect(
      resolvePortalOrigin({
        context: "deploy-preview",
        ephemeral: true,
        testUrl: "http://127.0.0.1:8888",
      }),
    ).toBe("http://127.0.0.1:8888");
    expect(() =>
      resolvePortalOrigin({
        context: "deploy-preview",
        siteUrl: "http://127.0.0.1:8888",
      }),
    ).toThrow();
  });
  it("fails closed when preview metadata is absent or points at production", () => {
    for (const siteUrl of [
      undefined,
      "https://portal.d-a-j.com",
      "https://portal.daj.com",
      "https://studio-portal.netlify.app",
      "https://user:password@preview.example.test",
    ])
      expect(() =>
        resolvePortalOrigin({ context: "deploy-preview", siteUrl }),
      ).toThrow();
  });
  it("keeps booking management token-scoped and percent encodes identifiers", () => {
    expect(
      portalActionUrl(
        "https://preview.example.test",
        "booking",
        "abc/?email=private",
      ),
    ).toBe("https://preview.example.test/booking/abc%2F%3Femail%3Dprivate");
  });
});
describe("shared branded email presentation", () => {
  const input = {
    greeting: "Hi Jordan,",
    message: "Your lesson is tomorrow.",
    primaryAction: {
      label: "View Lesson",
      url: "https://preview.example.test/portal/lessons/lesson",
    },
    coachName: "Darius",
    studioName: "Coach’D",
    logoUrl: "https://assets.example.test/logo.png",
  };
  it("places a configured logo at the bottom after signoff and footer", () => {
    const result = renderStudioEmail(input);
    expect(result.html.indexOf("<img")).toBeGreaterThan(
      result.html.indexOf("<footer"),
    );
    expect(result.html.indexOf("<footer")).toBeGreaterThan(
      result.html.indexOf("Darius"),
    );
    expect(result.text).toContain(
      "View Lesson: https://preview.example.test/portal/lessons/lesson",
    );
    expect(result.text).toContain("Darius\n\nCoach’D");
  });
  it("escapes templates and rejects unsafe CTA and logo schemes", () => {
    const result = renderStudioEmail({
      ...input,
      message: "<script>alert('x')</script>",
      primaryAction: { label: "Unsafe", url: "javascript:alert(1)" },
      logoUrl: "data:image/svg+xml,unsafe",
    });
    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toContain("<img");
    expect(result.html).not.toContain("javascript:");
    expect(result.text).not.toContain("Unsafe:");
  });
  it("does not require images or expose a Meet link early", () => {
    const result = renderStudioEmail({ ...input, logoUrl: undefined });
    expect(result.text).toContain("Your lesson is tomorrow.");
    expect(result.html).not.toContain("meet.google.com");
    expect(result.html).not.toContain("<img");
  });
});
