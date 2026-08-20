import { afterEach, describe, expect, it, vi } from "vitest";
import { googleAccessToken, googleFreeBusy, sendGmail } from "./google";

afterEach(() => vi.unstubAllGlobals());

describe("Google provider adapter", () => {
  it("supports the deployed OAuth environment aliases", async () => {
    vi.stubGlobal("Netlify", { env: { get: (name: string) => ({ GOOGLE_OAUTH_CLIENT_ID: "client", GOOGLE_OAUTH_CLIENT_SECRET: "secret", GOOGLE_REFRESH_TOKEN: "refresh" } as Record<string, string>)[name] } });
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "token" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", request);
    await expect(googleAccessToken()).resolves.toBe("token");
    expect(String(request.mock.calls[0][1]?.body)).toContain("client_id=client");
  });

  it("fails closed when Calendar reports a provider error", async () => {
    vi.stubGlobal("Netlify", { env: { get: (name: string) => name === "GOOGLE_CALENDAR_ID" ? "primary" : undefined } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ calendars: { primary: { errors: [{ reason: "backendError" }] } } }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(googleFreeBusy("token", "2030-01-01T00:00:00Z", "2030-01-02T00:00:00Z")).rejects.toThrow("CALENDAR_UNAVAILABLE");
  });

  it("sends Gmail messages as base64url MIME payloads", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "gmail-1" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", request);
    await expect(sendGmail("token", { recipient: "student@example.com", subject: "Reminder", body: "Your lesson starts soon." })).resolves.toEqual({ id: "gmail-1" });
    const payload = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(Buffer.from(payload.raw, "base64url").toString()).toContain("To: student@example.com");
  });
});
