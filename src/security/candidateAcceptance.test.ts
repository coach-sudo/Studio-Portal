import { describe, expect, it } from "vitest";
import {
  candidateTargetSchema,
  allowedCandidateRead,
  classifyCandidateEndpoint,
} from "./candidateAcceptance";
import { hostedAcceptance } from "./hostedAcceptance";
// Offline policy fixture; this is never a returned deployment identity.
const target = {
  ...hostedAcceptance,
  site: "d83ff6cb-f57b-4741-8c3c-3eaae7adab19",
  deployment: "aaaaaaaaaaaaaaaaaaaaaaaa",
  commit: "a".repeat(40),
  context: "deploy-preview",
  origin: "https://aaaaaaaaaaaaaaaaaaaaaaaa--coachd-staging.netlify.app",
} as const;
describe("candidate browser perimeter", () => {
  it("permits only the reviewed missing-lesson delivery denial probe", () => {
    const path =
      "/api/v2/portal/lessons/00000000-0000-4000-8000-000000000001/delivery";
    expect(allowedCandidateRead(target, "GET", target.origin + path)).toBe(
      true,
    );
    for (const suffix of ["?send=true", "#send"])
      expect(
        allowedCandidateRead(target, "GET", target.origin + path + suffix),
      ).toBe(false);
    expect(allowedCandidateRead(target, "POST", target.origin + path)).toBe(
      false,
    );
    expect(
      allowedCandidateRead(
        target,
        "GET",
        target.origin + path.replace(/000000000001/, "000000000002"),
      ),
    ).toBe(false);
  });
  it("rejects credential-bearing and encoded read wrappers before command classification", () => {
    for (const url of [
      target.origin.replace("https://", "https://user:password@") +
        "/api/v2/lessons",
      target.origin + "/api/v2/%6cessons",
    ])
      expect(
        allowedCandidateRead(target, "POST", url, {
          command: "bulk_candidates",
        }),
      ).toBe(false);
  });
  it("requires an exact new immutable staging identity", () => {
    expect(candidateTargetSchema.parse(target)).toEqual(target);
    for (const patch of [
      { project: "htwthzshhilrjtqwprlo" },
      { site: "93829451-dbcf-4863-a07f-fa448cb17494" },
      { studio: "other" },
      { context: "production" },
      { origin: "https://portal.d-a-j.com" },
      { origin: "https://coachd-staging.netlify.app" },
      {
        deployment: "6ad23d4f8b10c10447224155",
        origin: hostedAcceptance.origin,
      },
    ])
      expect(() =>
        candidateTargetSchema.parse({ ...target, ...patch }),
      ).toThrow();
  });
  it.each(["bulk_candidates", "bulk_progress", "record_history"])(
    "allows bounded read wrapper assessment %s",
    (command) => {
      expect(
        allowedCandidateRead(
          target,
          "POST",
          target.origin + "/api/v2/lessons",
          { command },
        ),
      ).toBe(true);
    },
  );
  it("rejects decorated read-wrapper URLs instead of widening the exact endpoint", () => {
    for (const suffix of ["?command=create", "#preview_bulk"])
      expect(
        allowedCandidateRead(
          target,
          "POST",
          target.origin + "/api/v2/lessons" + suffix,
          {
            command: "bulk_candidates",
          },
        ),
      ).toBe(false);
  });
  it.each([
    "create",
    "update_details",
    "preview_change",
    "preview_bulk",
    "execute_bulk",
    "retry_bulk",
  ])("does not authorize reviewed future mutation %s", (command) => {
    expect(
      allowedCandidateRead(target, "POST", target.origin + "/api/v2/lessons", {
        command,
      }),
    ).toBe(false);
  });
  it("blocks reschedule even without provider credentials", () => {
    expect(
      classifyCandidateEndpoint(
        target,
        "POST",
        target.origin + "/api/v2/lessons",
        { command: "execute_change", payload: { action: "reschedule" } },
      ),
    ).toBe("provider-prohibited");
    expect(
      classifyCandidateEndpoint(
        target,
        "POST",
        target.origin + "/api/v2/lessons",
        { command: "execute_change", payload: { action: "cancel" } },
      ),
    ).toBe("approval-required");
  });
  it.each([
    "/api/v2/health",
    "/api/v2/auth/claim-access",
    "/api/v2/students",
    "/api/v2/finance",
    "/api/v2/admin/booking/check_conflicts",
    "/api/v2/portal/bookings/reschedule",
    "/api/e2e/fixtures",
    "/.netlify/functions/outbox-worker",
    "/api/v2/%6cessons",
  ])("blocks unreviewed/provider route %s", (path) => {
    expect(
      allowedCandidateRead(target, "POST", target.origin + path, {
        command: "create",
      }),
    ).toBe(false);
    expect(allowedCandidateRead(target, "GET", target.origin + path)).toBe(
      false,
    );
  });
  it.each([
    "https://api.stripe.com",
    "https://www.googleapis.com",
    "https://htwthzshhilrjtqwprlo.supabase.co",
    hostedAcceptance.origin,
    "http://127.0.0.1:4187",
  ])("rejects off-target endpoint %s", (origin) => {
    expect(allowedCandidateRead(target, "GET", origin + "/coach")).toBe(false);
  });
});
