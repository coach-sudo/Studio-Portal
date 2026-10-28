import type { BrowserContext } from "@playwright/test";
import { installFixture, ids } from "../candidate-local/fixture";
export const duplicateId = "70000000-0000-4000-8000-000000000090",
  groupId = "70000000-0000-4000-8000-000000000091";
export async function identityFixture(context: BrowserContext) {
  await installFixture(context, "coach", { student: "Alex Current" });
  const rows = [
    {
      id: ids.student,
      studio_id: ids.studio,
      user_id: ids.learner,
      full_name: "Alex Current",
      preferred_name: "Alex Current",
      email: "current@example.test",
      status: "active",
      portal_enabled: true,
      version: 1,
      timezone: "America/New_York",
      timezone_confirmed: true,
      tags: [],
      created_at: "2020-01-01T00:00:00Z",
      updated_at: "2020-01-01T00:00:00Z",
      deleted_at: null,
    },
    {
      id: duplicateId,
      studio_id: ids.studio,
      user_id: null,
      full_name:
        "Alex Original — historical coaching and original financial records",
      preferred_name: "Alex Original",
      email: "original@example.test",
      status: "active",
      portal_enabled: true,
      version: 1,
      timezone: "America/New_York",
      timezone_confirmed: true,
      tags: [],
      created_at: "2020-01-01T00:00:00Z",
      updated_at: "2020-01-01T00:00:00Z",
      deleted_at: null,
    },
  ];
  const state = {
    commands: [] as Record<string, unknown>[],
    lost: false,
    grouped: false,
    held: false,
    historyFailed: false,
    refreshFailed: false,
  };
  await context.route("**/rest/v1/students?*", async (route) => {
    const url = new URL(route.request().url());
    let selected = rows;
    const id = url.searchParams.get("id");
    if (id?.startsWith("eq."))
      selected = rows.filter((r) => r.id === id.slice(3));
    const single = route
      .request()
      .headers()
      .accept?.includes("vnd.pgrst.object");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "content-range",
        "content-range": `0-${Math.max(0, selected.length - 1)}/${selected.length}`,
      },
      body: JSON.stringify(single ? selected[0] : selected),
    });
  });
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
        students: rows,
        lessons: [],
        integrationImports: [],
        linkedContacts: [],
      }),
    }),
  );
  await context.route("**/api/v2/students", async (route) => {
    const body = route.request().postDataJSON(),
      proposal = body.payload?.proposal;
    state.commands.push(body);
    const reply = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (body.command === "preview_identity_change")
      return reply({
        resource: {
          phase: "preview",
          stamp: "a".repeat(64),
          proposal,
          blockedReason: state.held ? "different_authenticated_users" : null,
          currentProfile: { id: ids.student, name: "Alex Current", version: 1 },
          duplicateProfile:
            proposal.action === "group"
              ? { id: duplicateId, name: rows[1].full_name, version: 1 }
              : null,
          group: state.grouped
            ? {
                id: groupId,
                version: 1,
                currentStudentId: ids.student,
                memberCount: 26,
              }
            : null,
          profilesDeleted: false,
          financialEffects: [],
          permissionEffects: [],
          providerEffects: [],
        },
      });
    if (body.command === "identity_change") {
      state.grouped = proposal.action === "group";
      if (!state.lost) {
        state.lost = true;
        return route.abort("failed");
      }
      return reply({
        resource: {
          groupId,
          version: state.grouped ? 1 : 2,
          active: state.grouped,
          currentStudentId: ids.student,
          profilesDeleted: false,
        },
        auditEventId: groupId,
        queuedSideEffects: [],
      });
    }
    if (body.command === "identity_group") {
      if (!state.historyFailed) {
        return reply(
          {
            code: "PROVIDER_UNAVAILABLE",
            message: "Synthetic related-profile read unavailable",
            retryable: true,
            correlationId: "local-only",
          },
          503,
        );
      }
      const after = body.payload.afterStudent;
      const members = state.grouped
        ? after
          ? [
              {
                studentId: duplicateId,
                name: rows[1].full_name,
                status: "active",
                deletedAt: null,
                isCurrent: false,
              },
            ]
          : Array.from({ length: 26 }, (_, n) => ({
              studentId:
                n === 0
                  ? ids.student
                  : `70000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`,
              name:
                n === 0 ? "Alex Current" : "Synthetic original profile " + n,
              status: "active",
              deletedAt: null,
              isCurrent: n === 0,
            })).slice(0, 25)
        : [];
      return reply({
        resource: {
          group: state.grouped
            ? { id: groupId, version: 1, currentStudentId: ids.student }
            : null,
          members,
          total: state.grouped ? 26 : 0,
          hasMore: state.grouped && !after,
          nextAfterStudent:
            state.grouped && !after ? members.at(-1)!.studentId : null,
          financialAccountsRemainSeparate: true,
          permissionsRemainSeparate: true,
        },
      });
    }
    return reply(
      {
        code: "NOT_FOUND",
        message: "Fixture denies unimplemented command",
        retryable: false,
        correlationId: "local-only",
      },
      404,
    );
  });
  return state;
}
