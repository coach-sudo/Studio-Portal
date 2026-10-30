import type { BrowserContext } from "@playwright/test";
import { ids } from "../candidate-local/fixture";
const id = (n: number) =>
  `e8610000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export async function historicalFixture(context: BrowserContext) {
  const state = {
    requests: [] as Record<string, any>[],
    receipts: new Map<string, { hash: string; receipt: unknown }>(),
    logicalWrites: 0,
    lost: false,
    decisions: new Map<
      string,
      {
        id: string;
        version: number;
        disposition: string;
        lesson_id: string | null;
        reason: string;
      }
    >(),
    reopened: new Set<string>(),
  };
  const original = {
    id: ids.lesson,
    version: 3,
    topic: "Original paid completed lesson",
    startsAt: "2020-01-01T15:00:00Z",
    endsAt: "2020-01-01T16:00:00Z",
    status: "completed",
  };
  const source = (candidateId: string) => ({
    candidateId,
    studioId: ids.studio,
    calendarId: "alpha",
    eventId: "original-event",
    summary: "Historical source evidence",
    sourceStatus: "active",
    reasonCode: "date_only_requires_time",
    stamp: "a".repeat(64),
    observation: {
      startsAt: null,
      endsAt: null,
      startDate: "2020-01-01",
      endDate: "2020-01-02",
    },
    decision: state.decisions.get(candidateId) || null,
    priorSignals: state.reopened.has(candidateId)
      ? []
      : [
          {
            id: id(7),
            status: "ignored",
            lessonId: null,
            updatedAt: "2020-02-01T00:00:00Z",
            matchType: "legacy_unscoped",
          },
        ],
    linkedLessons: [],
    attendanceVerified: false,
    financialCoverageVerified: false,
    canonicalEffects: [],
  });
  await context.route("**/rest/v1/rpc/studio_global_search", (route) => {
    const body = route.request().postDataJSON(),
      kind = body.p_group;
    return route.fulfill({
      json: {
        items: [
          {
            kind,
            id: kind === "student" ? ids.student : ids.lesson,
            studentId: ids.student,
            title:
              kind === "student" ? "Original student record" : original.topic,
            snippet: "Original history remains separate",
          },
        ],
        moreGroups: body.p_page === 1 ? [kind] : [],
        page: body.p_page,
      },
    });
  });
  await context.route("**/rest/v1/lessons?*", (route) =>
    route.fulfill({
      json: {
        id: original.id,
        version: original.version,
        topic: original.topic,
        starts_at: original.startsAt,
        ends_at: original.endsAt,
        status: original.status,
      },
    }),
  );
  await context.route("**/api/v2/integrations", (route) => {
    const body = route.request().postDataJSON(),
      p = body.payload || {},
      name = body.command,
      reply = (resource: unknown) => route.fulfill({ json: { resource } });
    if (!String(name).includes("historical_calendar")) return route.fallback();
    if (
      name === "preview_historical_calendar_reopening" ||
      name === "preview_historical_calendar_review"
    )
      return reply(source(p.candidateId));
    if (name === "historical_calendar_decision_history")
      return reply({
        items: Array.from({ length: p.beforeVersion ? 1 : 25 }, (_, n) => ({
          version: p.beforeVersion ? 1 : 26 - n,
          action: "reopen",
          reason: "Synthetic explicit prior review",
          createdAt: "2020-02-01T00:00:00Z",
        })),
        total: 26,
        hasMore: !p.beforeVersion,
        nextBeforeVersion: p.beforeVersion ? null : 2,
      });
    if (name === "preview_historical_calendar_reconciliation") {
      const proposal = p.proposal,
        create = proposal.action === "create";
      return reply({
        ...source(p.candidateId),
        phase: "preview",
        proposal,
        student: {
          id: ids.student,
          name: "Original student record",
          version: 1,
        },
        target: create ? null : original,
        startsAt: create ? proposal.startsAt : original.startsAt,
        endsAt: create ? proposal.endsAt : original.endsAt,
        sourceDifference: true,
        sourceMatchCount: 0,
        intervalMatchCount: 0,
        sourceMatchExamples: [],
        intervalMatchExamples: [],
        examplesAreComplete: true,
        blockedReason: !state.reopened.has(p.candidateId)
          ? "reopen_required"
          : !proposal.acknowledgeSourceDifference
            ? "source_difference_acknowledgement_required"
            : null,
        recordedOutcome: create ? "scheduled" : "completed",
        proposedCanonicalEffects: create
          ? ["historical_lesson", "confirmed_participant"]
          : [],
      });
    }
    const canonical = name === "historical_calendar_reconciliation";
    if (!canonical && name !== "historical_calendar_review")
      return route.fallback();
    state.requests.push(structuredClone(body));
    const key = body.idempotencyKey,
      hash = JSON.stringify({ name, p }),
      previous = state.receipts.get(key);
    if (previous) {
      if (previous.hash !== hash)
        return route.fulfill({
          status: 409,
          json: {
            code: "IDEMPOTENCY_CONFLICT",
            message: "Synthetic replay conflict",
            retryable: false,
            correlationId: "historical-fixture",
          },
        });
      return route.fulfill({ json: previous.receipt });
    }
    const proposal = p.proposal,
      create = canonical && proposal.action === "create",
      lessonId = canonical
        ? create
          ? id(8)
          : ids.lesson
        : state.decisions.get(p.candidateId)?.lesson_id || null,
      disposition = canonical
        ? "linked"
        : p.action === "skip"
          ? "skipped"
          : p.action === "not_lesson"
            ? "not_lesson"
            : "review";
    state.decisions.set(p.candidateId, {
      id: id(5),
      version: (state.decisions.get(p.candidateId)?.version || 0) + 1,
      disposition,
      lesson_id: lessonId,
      reason: p.reason || proposal.reason,
    });
    if (p.action === "reopen") state.reopened.add(p.candidateId);
    const receipt = {
      resource: {
        candidateId: p.candidateId,
        decisionId: id(5),
        lessonId,
        attendanceVerified: false,
        financialCoverageVerified: false,
        ...(canonical
          ? {
              studentId: ids.student,
              created: create,
              linked: true,
              recordedOutcome: create ? "scheduled" : "completed",
            }
          : { disposition }),
      },
      auditEventId: id(6),
      queuedSideEffects: [],
    };
    state.logicalWrites++;
    state.receipts.set(key, { hash, receipt });
    if (create && !state.lost) {
      state.lost = true;
      return route.fulfill({
        status: 503,
        json: {
          code: "HTTP_ERROR",
          message: "Synthetic committed response lost. Recover unchanged.",
          retryable: true,
          correlationId: "historical-fixture",
        },
      });
    }
    return route.fulfill({ json: receipt });
  });
  return state;
}
