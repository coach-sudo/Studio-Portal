import { describe, expect, it } from "vitest";
import {
  allowedHostedRequest,
  assertFixtureMutationTarget,
  assertHostedAcceptanceTarget,
  hostedAcceptance,
} from "./hostedAcceptance";
const origin = hostedAcceptance.origin;
const db = `https://${hostedAcceptance.project}.supabase.co`;
describe("hosted acceptance fences", () => {
  it.each([
    "https://portal.d-a-j.com",
    "https://htwthzshhilrjtqwprlo.supabase.co",
    "https://coachd-staging.netlify.app",
    origin + "/",
    "http://localhost:8888",
  ])("rejects wrong target %s", (value) =>
    expect(() => assertHostedAcceptanceTarget(value)).toThrow(),
  );
  it("accepts only the approved immutable origin", () =>
    expect(() => assertHostedAcceptanceTarget(origin)).not.toThrow());
  it.each([
    "/api/e2e/fixtures",
    "/api/v2/lessons",
    "/api/v2/finance",
    "/api/v2/messages",
    "/api/v2/auth/claim-access",
    "/api/v2/auth/password-changed",
    "/.netlify/functions/calendar-worker",
    "/.netlify/functions/provider-intake",
  ])("blocks hosted business/worker endpoint %s", (p) =>
    expect(allowedHostedRequest("POST", origin + p)).toBe(false),
  );
  it.each([
    "reserve_student_upcoming_credits",
    "command_create_lesson",
    "claim_portal_access_by_verified_email",
    "set_student_credit_auto",
  ])("blocks mutating RPC %s", (p) =>
    expect(allowedHostedRequest("POST", db + "/rest/v1/rpc/" + p)).toBe(false),
  );
  it.each(["POST", "PATCH", "PUT", "DELETE"])("blocks table mutation %s", (m) =>
    expect(allowedHostedRequest(m, db + "/rest/v1/lessons")).toBe(false),
  );
  it.each([
    "https://portal.d-a-j.com/api/healthz",
    "https://portal.daj.com",
    "https://studio-portal.netlify.app",
    "https://api.stripe.com",
    "https://www.googleapis.com",
    "https://htwthzshhilrjtqwprlo.supabase.co/rest/v1/students",
    origin + ".attacker.test",
    origin.replace("https:", "http:"),
  ])("blocks forbidden network %s", (u) =>
    expect(allowedHostedRequest("GET", u)).toBe(false),
  );
  it("allows authorized reads and session operations only", () => {
    for (const [m, u] of [
      ["GET", origin + "/coach"],
      ["GET", origin + "/api/healthz"],
      ["GET", origin + "/api/invoices"],
      ["POST", origin + "/api/v2/auth/login"],
      ["POST", db + "/auth/v1/token?grant_type=password"],
      ["POST", db + "/auth/v1/logout"],
      ["GET", db + "/rest/v1/students"],
      ["POST", db + "/rest/v1/rpc/student_financial_overview"],
    ])
      expect(allowedHostedRequest(m, u)).toBe(true);
    expect(allowedHostedRequest("POST", db + "/auth/v1/recover")).toBe(false);
    expect(
      allowedHostedRequest("POST", db + "/auth/v1/token?grant_type=pkce"),
    ).toBe(false);
  });
  it.each([
    "/rest/v1/%72pc/command_create_lesson",
    "/rest/v1/rpc%2fcommand_create_lesson",
    "/rest/v1/rpc/%73tudent_credit_coverage",
  ])("rejects encoded endpoint %s", (path) => {
    expect(allowedHostedRequest("GET", db + path)).toBe(false);
  });
  it("blocks provider-capable platform health even though it uses GET", () => {
    expect(allowedHostedRequest("GET", origin + "/api/v2/health")).toBe(false);
  });
  it("legacy fixtures remain loopback-only", () => {
    expect(() => assertFixtureMutationTarget(origin)).toThrow();
    expect(() =>
      assertFixtureMutationTarget("http://127.0.0.1:8888"),
    ).not.toThrow();
  });
});
