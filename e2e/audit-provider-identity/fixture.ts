import type { BrowserContext } from "@playwright/test";
import { ids, installFixture } from "../candidate-local/fixture";
export const selectedId = "e8900000-0000-4000-8000-000000000011";
export async function providerIdentityFixture(context: BrowserContext) {
  await installFixture(context, "coach", { student: "Alex Original" });
  const students = [ids.student, selectedId].map((id, n) => ({
    id,
    studio_id: ids.studio,
    user_id: n ? null : ids.learner,
    full_name: n ? "Alex Selected" : "Alex Original",
    preferred_name: n ? "Alex Selected" : "Alex Original",
    email: n ? "selected@example.test" : "original@example.test",
    status: "active",
    portal_enabled: false,
    version: 1,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
    deleted_at: null,
  }));
  const state = {
    linked: false,
    reviewed: false,
    lost: false,
    commands: [] as Record<string, unknown>[],
  };
  const lesson = {
    id: ids.lesson,
    studio_id: ids.studio,
    student_id: ids.student,
    topic: "Original provider lesson",
    starts_at: "2031-11-02T18:00:00Z",
    ends_at: "2031-11-02T19:00:00Z",
    status: "scheduled",
    location_type: "in_person",
    location_label: "Studio",
    version: 1,
  };
  await context.route("**/rest/v1/students?*", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(students),
    }),
  );
  await context.route("**/rest/v1/rpc/studio_route_snapshot", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        currentUserId: ids.coach,
        membership: {
          studio_id: ids.studio,
          user_id: ids.coach,
          role: "coach",
          display_name: "E2E Coach",
        },
        studio: {
          id: ids.studio,
          name: "Candidate Studio",
          timezone: "America/New_York",
          settings: {},
        },
        students,
        lessons: state.linked ? [lesson] : [],
        linkedContacts: [],
        integrationImports: state.reviewed
          ? []
          : [
              {
                id: "e8900000-0000-4000-8000-000000000030",
                studio_id: ids.studio,
                student_id: ids.student,
                lesson_id: state.linked ? ids.lesson : null,
                provider: "gmail",
                detected_source: "superprof",
                external_id: "synthetic-provider-identity",
                status: "needs_review",
                confidence: 0.5,
                payload: {
                  candidate: {
                    startsAt: lesson.starts_at,
                    endsAt: lesson.ends_at,
                    topic: lesson.topic,
                  },
                  changeType: "confirmation",
                },
                updated_at: "2026-10-20T00:00:00Z",
                created_at: "2026-10-20T00:00:00Z",
              },
            ],
      }),
    }),
  );
  await context.route("**/api/v2/integrations", async (route) => {
    const body = route.request().postDataJSON();
    state.commands.push(body);
    if (!state.lost) {
      state.lost = true;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "PROVIDER_UNAVAILABLE",
          message: "Synthetic response lost. Retry this review.",
          retryable: true,
          correlationId: "local-provider-identity-fault",
        }),
      });
    }
    state.reviewed = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        resource: { reviewed: 1 },
        queuedSideEffects: [],
      }),
    });
  });
  return state;
}
