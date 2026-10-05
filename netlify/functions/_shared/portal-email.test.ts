import { describe, expect, it } from "vitest";
import { resolvePortalOrigin, portalActionUrl } from "./portal-url";
import { renderStudioEmail } from "./email-presentation";
import { presentOutboxMessage } from "./outbox-presentation";

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
  it("presents SQL note emails and repeated dispatch without duplicating the signoff", () => {
    const studio = {
      name: "Coach’D",
      settings: {
        coachName: "Darius",
        branding: { logoUrl: "https://assets.example.test/logo.png" },
      },
    };
    const first = presentOutboxMessage(
      {
        body: "Hi Jordan,\n\nYour notes are ready.",
        event_key: "note.published.student",
      },
      studio,
      "https://preview.example.test",
    );
    expect(first.text).toContain(
      "Read Lesson Notes: https://preview.example.test/portal/work",
    );
    const again = presentOutboxMessage(
      { body: first.text, event_key: "note.published.student" },
      studio,
      "https://preview.example.test",
    );
    expect(again.text.match(/Darius/g)).toHaveLength(1);
    expect(again.html.indexOf("<img")).toBeGreaterThan(
      again.html.indexOf("<footer"),
    );
  });
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
  it("preserves legacy trusted token-scoped booking management without private query strings", () => {
    const email = presentOutboxMessage(
      {
        body: "Hi Jordan,\nManage: https://preview.example.test/booking/scoped-token?email=private#fragment",
        event_key: "booking.confirmed.student",
      },
      { name: "Coach’D" },
      "https://preview.example.test",
    );
    expect(email.text).toContain(
      "View / Manage Booking: https://preview.example.test/booking/scoped-token",
    );
    expect(email.text).not.toContain("email=private");
    expect(email.html).not.toContain("fragment");
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
