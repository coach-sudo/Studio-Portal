// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import {
  currentObservation,
  dashboardSystemIssues,
  diagnosticText,
  type HealthIssue,
  type StudioHealth,
} from "../../../src/domain/systemHealth";
import { deriveObservation, runStudioHealth } from "./studio-health";

const now = "2026-11-23T15:00:00Z";
const options = {
  owner: true,
  google: true,
  stripe: true,
  calendar: "primary",
  checkedAt: now,
  workers: { calendar: true, email: true, jobs: true, intake: false },
};
const evidence = {
  lastSuccessAt: null,
  problems: [],
  complete: true,
  pending: 0,
};
afterEach(() => vi.unstubAllGlobals());

it("distinguishes OAuth verification, configuration, evidence freshness and unobserved activity", () => {
  expect(
    deriveObservation("calendar", evidence, {
      ...options,
      probe: { at: now, result: "accessible" },
    }),
  ).toMatchObject({
    configured: true,
    authorization: "verified",
    state: "unavailable",
  });
  expect(deriveObservation("stripe", evidence, options).state).toBe(
    "unavailable",
  );
  const accepted = deriveObservation(
    "email",
    { ...evidence, lastSuccessAt: now },
    options,
  );
  expect(accepted.detail).toMatch(/accepted.*Recipient delivery/);
  expect(accepted.state).toBe("healthy");
  expect(
    currentObservation(accepted, Date.parse(now) + 36 * 60_000).state,
  ).toBe("unavailable");
});

it("makes timeouts observable, preserves unresolved evidence and respects disabled jobs", () => {
  expect(deriveObservation("email", undefined, options)).toMatchObject({
    complete: false,
    problems: [],
    state: "unavailable",
  });
  expect(
    deriveObservation(
      "jobs",
      {
        ...evidence,
        problems: [{ key: "maintenance", category: "job_stalled" }],
      },
      { ...options, workers: { ...options.workers, jobs: false } },
    ),
  ).toMatchObject({ problems: [], state: "unavailable" });
  expect(
    deriveObservation(
      "calendar",
      {
        ...evidence,
        lastSuccessAt: now,
        problems: [
          {
            key: "projection",
            category: "calendar_sync",
            phase: "open",
            retryable: true,
            scope: "lesson",
          },
        ],
      },
      { ...options, probe: { at: now, result: "accessible" } },
    ),
  ).toMatchObject({
    state: "degraded",
    authorization: "verified",
    problems: [{ retryable: true, severity: "review" }],
  });
});

const baseIssue: HealthIssue = {
  id: "00000000-0000-4000-8000-000000000001",
  service: "email",
  category: "email_preflight",
  phase: "open",
  severity: "high",
  firstSeen: now,
  lastSeen: now,
  occurrences: 1,
  recovery: [],
};
it("deduplicates Dashboard warnings and keeps diagnostics free of arbitrary data", () => {
  const recent = new Date().toISOString();
  const report: StudioHealth = {
    checkedAt: recent,
    automaticAt: recent,
    checking: false,
    observations: [
      deriveObservation("email", evidence, { ...options, checkedAt: recent }),
    ],
    issues: [
      baseIssue,
      { ...baseIssue, id: "another" },
      { ...baseIssue, service: "calendar", resolvedAt: now },
    ],
    release: { context: "deploy-preview", commit: "1f3896a246f9" },
  };
  expect(dashboardSystemIssues(report)).toEqual([baseIssue]);
  const copied = diagnosticText(
    {
      ...baseIssue,
      operation: "raw-secret@example.test",
      sourceReference: "private secret",
      recovery: [{ at: now, result: "queued", correlationId: "reference" }],
    },
    report,
    "America/New_York",
  );
  expect(copied).toContain("Recovery queued");
  expect(copied).not.toContain("raw-secret@example.test");
  expect(copied).not.toContain("private secret");
});

function runner(lease: string | null, unavailable?: string) {
  const rpc = vi.fn((name: string, args?: Record<string, unknown>) => ({
    abortSignal: (signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      if (name === "studio_health_claim")
        return Promise.resolve({ data: lease });
      if (name === "studio_health_studio_slug")
        return Promise.resolve({ data: "stage-story" });
      if (name === "studio_health_read")
        return Promise.resolve({ data: { observations: [], issues: [] } });
      if (name === "gmail_delivery_oauth_status")
        return Promise.resolve({ data: null });
      if (name === "studio_health_evidence")
        return Promise.resolve(
          args?.p_service === unavailable
            ? { error: { code: "timeout" } }
            : { data: evidence },
        );
      return Promise.resolve({ data: true });
    },
  }));
  const studio = {
    select: () => studio,
    eq: () => studio,
    abortSignal: () => studio,
    single: async () => ({ data: { id: "studio", slug: "stage-story" } }),
  };
  return { rpc, db: { rpc, from: () => studio } as unknown as SupabaseClient };
}
function syntheticGoogle() {
  vi.stubGlobal("Netlify", {
    env: {
      get: (key: string) =>
        [
          "GOOGLE_CLIENT_ID",
          "GOOGLE_CLIENT_SECRET",
          "GOOGLE_REFRESH_TOKEN",
        ].includes(key)
          ? "synthetic"
          : undefined,
    },
  });
}

it("checks Google with bounded token and read requests, preserving results when another source times out", async () => {
  syntheticGoogle();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: "synthetic" }))
    .mockResolvedValueOnce(
      Response.json({ summary: "Studio calendar", accessRole: "writer" }),
    );
  vi.stubGlobal("fetch", fetcher);
  const { db, rpc } = runner("lease", "stripe");
  await expect(runStudioHealth(db, "studio", false)).resolves.toMatchObject({
    state: "completed",
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][0]).toMatch(/\/calendarList\/primary\?/);
  expect(fetcher.mock.calls[1][1]).toMatchObject({
    signal: expect.any(AbortSignal),
    redirect: "error",
  });
  expect(fetcher.mock.calls[1][1].method).toBeUndefined();
  const result = rpc.mock.calls.find(
    ([name]) => name === "studio_health_finish",
  )?.[1]?.p_results;
  expect(result).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        service: "calendar",
        authorization: "verified",
      }),
      expect.objectContaining({
        service: "stripe",
        state: "unavailable",
        complete: false,
      }),
    ]),
  );
  expect(
    rpc.mock.calls
      .map(([name]) => name)
      .every(
        (name) =>
          name.startsWith("studio_health_") ||
          name === "gmail_delivery_oauth_status",
      ),
  ).toBe(true);
});

it("reports revoked Calendar authorization without attributing it to Gmail or exposing the OAuth response", async () => {
  syntheticGoogle();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(
        {
          error: "invalid_grant",
          error_description: "sensitive provider data",
        },
        { status: 400 },
      ),
    ),
  );
  const { db, rpc } = runner("lease");
  await runStudioHealth(db, "studio", false);
  const result = rpc.mock.calls.find(
    ([name]) => name === "studio_health_finish",
  )?.[1]?.p_results;
  expect(result).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        service: "calendar",
        authorization: "needs_review",
      }),
      expect.objectContaining({
        service: "email",
        authorization: "unknown",
        configured: true,
      }),
    ]),
  );
  expect(JSON.stringify(result)).not.toContain("sensitive provider data");
});

it("checks only stored evidence automatically and coalesces an overlapping run", async () => {
  syntheticGoogle();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await runStudioHealth(runner("lease").db, "studio", true);
  const { db, rpc } = runner(null);
  await expect(runStudioHealth(db, "studio", false)).resolves.toMatchObject({
    state: "recent_or_running",
  });
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "studio_health_claim",
    "studio_health_read",
  ]);
  expect(fetcher).not.toHaveBeenCalled();
});
