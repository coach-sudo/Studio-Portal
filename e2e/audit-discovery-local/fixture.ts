import type { BrowserContext } from "@playwright/test";
import { ids } from "../candidate-local/fixture";
export const scanId = "e8000000-0000-4000-8000-000000000001";
export const sourceNames = {
  alpha: "Studio Calendar",
  beta: "Historical Calendar — recurring coaching and historical appointment evidence",
};
export async function discoveryFixture(context: BrowserContext) {
  const state = {
    starts: [] as Record<string, unknown>[],
    pages: [] as Record<string, unknown>[],
    alphaSaved: false,
    betaSaved: false,
    betaFailed: false,
  };
  const alphaItems = Array.from({ length: 26 }, (_, n) => ({
    id: `e8000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`,
    calendarId: "alpha",
    eventId: `event-${n}`,
    sourceKey: JSON.stringify(["alpha", `event-${n}`]),
    summary:
      n === 0
        ? "Date-only coaching evidence"
        : n === 1
          ? "Cancelled recurring source"
          : n === 2
            ? "Recurring exception"
            : "Synthetic source evidence " + n,
    sourceStatus: n === 1 ? "cancelled" : "active",
    startsAt: n === 0 || n === 1 ? null : "2020-01-02T15:00:00Z",
    endsAt: n === 0 || n === 1 ? null : "2020-01-02T16:00:00Z",
    startDate: n === 0 ? "2020-01-01" : null,
    endDate: n === 0 ? "2020-01-02" : null,
    timezone: "America/New_York",
    recurringEventId: n === 1 || n === 2 ? "synthetic-series" : null,
    originalStart: n === 1 || n === 2 ? "2020-01-01T15:00:00Z" : null,
    reasonCode:
      n === 0
        ? "date_only_requires_time"
        : n === 1
          ? "cancelled_source_requires_review"
          : "event_detected",
    possibleLessonCount: n === 3 ? 1 : 0,
    possiblePriorSignals:
      n === 3
        ? [
            {
              id: "e8000000-0000-4000-8000-000000000022",
              status: "ignored",
              lessonId: ids.lesson,
              matchType: "legacy_unscoped",
            },
          ]
        : [],
  }));
  const candidates = () => [
    ...(state.alphaSaved ? alphaItems : []),
    ...(state.betaSaved
      ? [
          {
            ...alphaItems[0],
            id: "e8000000-0000-4000-8000-000000000200",
            calendarId: "beta",
            sourceKey: '["beta","event-0"]',
          },
        ]
      : []),
  ];
  const progress = (cursor?: string) => {
    const items = candidates(),
      more = !cursor && items.length > 25;
    return {
      scanId,
      from: "2020-01-01T14:00:00Z",
      to: "2020-02-01T14:00:00Z",
      timezone: "America/New_York",
      status:
        state.alphaSaved && state.betaSaved
          ? "completed"
          : state.betaFailed
            ? "partial"
            : "queued",
      total: items.length,
      items: cursor ? items.slice(25) : items.slice(0, 25),
      hasMore: more,
      nextCursor: more ? items[24].id : null,
      sources: (["alpha", "beta"] as const).map((id) => ({
        calendarId: id,
        label: sourceNames[id],
        calendarTimezone: "America/New_York",
        status: (id === "alpha" ? state.alphaSaved : state.betaSaved)
          ? "completed"
          : id === "beta" && state.betaFailed
            ? "failed"
            : "queued",
        pageSequence: (id === "alpha" ? state.alphaSaved : state.betaSaved)
          ? 1
          : 0,
        observed: (id === "alpha" ? state.alphaSaved : state.betaSaved)
          ? id === "alpha"
            ? 26
            : 1
          : 0,
        attempts: state.pages.filter(
          (p) => (p.payload as { calendarId?: string }).calendarId === id,
        ).length,
        lastAttemptAt: state.pages.length ? "2026-10-28T13:30:00Z" : null,
        lastSuccessAt: (id === "alpha" ? state.alphaSaved : state.betaSaved)
          ? "2026-10-28T13:30:00Z"
          : null,
        failureCode:
          id === "beta" && state.betaFailed && !state.betaSaved
            ? "access_denied"
            : null,
      })),
    };
  };
  await context.route("**/api/v2/integrations", (route) => {
    const body = route.request().postDataJSON(),
      payload = body.payload || {},
      reply = (resource: unknown) => route.fulfill({ json: { resource } }),
      failure = (message: string) =>
        route.fulfill({
          status: 503,
          json: {
            code: "PROVIDER_UNAVAILABLE",
            message,
            retryable: true,
            correlationId: "e2e-discovery",
          },
        });
    if (body.command === "list_calendars") {
      const id = payload.cursor ? "beta" : "alpha";
      return reply({
        items: [
          {
            id,
            label: sourceNames[id as "alpha" | "beta"],
            timezone: "America/New_York",
            primary: id === "alpha",
            selectable: true,
            accessRole: "owner",
          },
        ],
        hasMore: !payload.cursor,
        nextCursor: payload.cursor ? null : "second-calendar-page",
      });
    }
    if (body.command === "start_calendar_discovery") {
      state.starts.push(body);
      return state.starts.length === 1
        ? failure("Synthetic lost start response. Retry unchanged.")
        : reply({ scanId, accepted: true, statusAtAcceptance: "queued" });
    }
    if (body.command === "calendar_discovery_progress")
      return reply(progress(payload.cursor));
    if (body.command === "continue_calendar_discovery") {
      state.pages.push(body);
      const calls = state.pages.filter(
        (p) =>
          (p.payload as { calendarId?: string }).calendarId ===
          payload.calendarId,
      ).length;
      if (payload.calendarId === "alpha") {
        state.alphaSaved = true;
        if (calls === 1)
          return failure(
            "Synthetic checkpoint response lost. Refresh and recover the same receipt.",
          );
      } else if (calls === 1) {
        state.betaFailed = true;
        return failure(
          "Synthetic source access denied. Successful pages are retained.",
        );
      } else {
        state.betaSaved = true;
        state.betaFailed = false;
      }
      return reply({
        scanId,
        calendarId: payload.calendarId,
        pageSequence: 0,
        observed: payload.calendarId === "alpha" ? 26 : 1,
        checkpointCommitted: true,
      });
    }
    if (body.command === "list_calendar_discoveries")
      return reply({
        items: [
          {
            scanId,
            from: "2020-01-01T14:00:00Z",
            to: "2020-02-01T14:00:00Z",
            timezone: "America/New_York",
            createdAt: "2026-10-28T13:30:00Z",
            calendarCount: 2,
            candidateCount: candidates().length,
          },
        ],
        total: 1,
        hasMore: false,
        nextCursor: null,
      });
    return route.fallback();
  });
  return state;
}
