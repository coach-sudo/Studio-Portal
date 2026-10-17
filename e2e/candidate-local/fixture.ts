// Network fixtures exercise the real AuthGate, query hooks, mappers and UI.
// They are NOT a replacement for PostgreSQL authorization or hosted acceptance.
import type { BrowserContext, Route } from "@playwright/test";
export const ids = {
  studio: "70000000-0000-4000-8000-000000000001",
  student: "70000000-0000-4000-8000-000000000002",
  lesson: "70000000-0000-4000-8000-000000000003",
  contact: "70000000-0000-4000-8000-000000000004",
  coach: "70000000-0000-4000-8000-000000000005",
  learner: "70000000-0000-4000-8000-000000000006",
  guardian: "70000000-0000-4000-8000-000000000007",
  unrelated: "70000000-0000-4000-8000-000000000008",
} as const;
export type FixtureRole = "coach" | "student" | "guardian" | "unrelated";
export async function installFixture(
  context: BrowserContext,
  role: FixtureRole,
) {
  const identity = role === "student" ? ids.learner : ids[role];
  const user = {
    id: identity,
    aud: "authenticated",
    role: "authenticated",
    email: `${role}@example.test`,
    app_metadata: {},
    user_metadata: {},
  };
  const claims = {
    sub: identity,
    role: "authenticated",
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.local-test-signature`;
  await context.addInitScript(
    ({ jwt, user }) => {
      // Axe creates opaque sandbox frames. Synthetic auth belongs only to the
      // top-level loopback application, never to those frames or other origins.
      if (window !== window.top || location.origin !== "http://127.0.0.1:4187")
        return;
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: jwt,
          refresh_token: "local-contract-refresh",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          user,
        }),
      );
    },
    { jwt, user },
  );
  const student = {
    id: ids.student,
    studio_id: ids.studio,
    user_id: ids.learner,
    full_name: "E2E Candidate Student",
    preferred_name: "E2E Candidate Student",
    email: "student@example.test",
    status: "active",
    focus_area: "Audition preparation",
    portal_enabled: true,
    portal_username: "candidate-student",
    timezone: "America/New_York",
    timezone_confirmed: true,
    tags: [],
    goals: "Prepare confidently",
    version: 1,
    updated_at: new Date().toISOString(),
  };
  const lesson = {
    id: ids.lesson,
    studio_id: ids.studio,
    student_id: ids.student,
    topic: "Candidate scene study",
    starts_at: "2027-01-20T18:00:00Z",
    ends_at: "2027-01-20T19:00:00Z",
    status: "scheduled",
    location_type: "virtual",
    location_label: "Online",
    price_minor: 10000,
    paid_minor: 0,
    payment_status: "unpaid",
    version: 1,
    updated_at: new Date().toISOString(),
  };
  const contact = {
    id: ids.contact,
    studio_id: ids.studio,
    student_id: ids.student,
    user_id: ids.guardian,
    full_name: "Candidate Guardian",
    email: "guardian@example.test",
    relationship_type: "guardian",
    relationship_label: "Parent",
    is_primary_payer: true,
    is_primary_scheduling_contact: true,
    can_receive_notifications: false,
    portal_enabled: true,
    is_payer: true,
    can_manage_schedule: true,
    can_view_finance: true,
    can_view_schedule: true,
    can_view_work: true,
    can_manage_lessons: true,
    can_manage_profile: true,
    can_view_lessons: true,
    can_view_notes: true,
    can_view_materials: true,
    permissions: {
      payments: true,
      logistics: true,
      notes: true,
      materials: true,
    },
    version: 1,
  };
  const state = {
    pageErrors: [] as string[],
    requests: [] as string[],
    commands: [] as string[],
    keys: [] as string[],
    summaryFailure: false,
    empty: false,
    revoked: false,
    summaryDelay: 0,
    allowLocalMutation: false,
    staleReview: false,
    accepted: false,
  };
  for (const page of context.pages())
    page.on("pageerror", (error) => state.pageErrors.push(error.message));
  context.on("page", (page) =>
    page.on("pageerror", (error) => state.pageErrors.push(error.message)),
  );
  const jobId = "70000000-0000-4000-8000-000000000020";
  const reviewToken = "a".repeat(64);
  const progress = () => ({
    jobId,
    operation: "archive",
    scope: "selected",
    state: state.accepted ? "completed" : "reviewed",
    expiresAt: "2027-01-01T00:00:00Z",
    filter: { studentId: ids.student },
    reviewContext: {
      reviewToken,
      reason: "Local browser archive review",
      selectionMode: "ids",
      studentContextId: ids.student,
      wholeClass: false,
      useCredit: false,
      stopsFutureGeneration: false,
    },
    counts: {
      total: 1,
      eligible: 1,
      blocked: 0,
      succeeded: state.accepted ? 1 : 0,
      skipped: 0,
      conflicted: 0,
      failed: 0,
      pending: state.accepted ? 0 : 1,
      waiting: 0,
      processing: 0,
      synchronizationPending: 0,
    },
    items: [
      {
        id: jobId,
        lessonId: lesson.id,
        version: 1,
        status: state.accepted ? "succeeded" : "pending",
        studentNames: [student.full_name],
        reasonCode: null,
        result: null,
        attempts: state.accepted ? 1 : 0,
        retryable: false,
        nextRetryAt: null,
        assessment: {
          lessonId: lesson.id,
          version: 1,
          topic: lesson.topic,
          startsAt: lesson.starts_at,
          status: "cancelled",
          studentIds: [ids.student],
          eligible: true,
          reasonCode: null,
          dependencies: {},
          calendarEffect: false,
          notificationEffect: false,
          reservedCredits: 0,
          creditPolicy: "return",
          potentialNotificationStudentIds: [],
          financialConsequences: {
            paidAmountPreserved: true,
            initiatesCashRefund: false,
            creditSettlement: "none",
            invoiceLines: [],
          },
        },
      },
    ],
    offset: 0,
    limit: 25,
  });
  const finance = () => ({
    studentId: ids.student,
    evaluatedAt: new Date().toISOString(),
    balances: [
      {
        currency: "USD",
        dueMinor: state.empty ? 0 : 10000,
        dollarCreditMinor: 2500,
      },
    ],
    reviewRequired: false,
    pendingPayments: 0,
    unpaidInvoices: 0,
    activePackages: 0,
    expiringPackages: 0,
    renewalExceptions: 0,
  });
  const rows = (table: string): unknown[] => {
    if (role === "unrelated" || state.revoked) return [];
    if (table === "students") return [student];
    if (table === "memberships")
      return role === "coach"
        ? [
            {
              id: ids.coach,
              studio_id: ids.studio,
              role: "coach",
              display_name: "Candidate Coach",
            },
          ]
        : [];
    if (table === "studios")
      return [
        {
          id: ids.studio,
          name: "Candidate Studio",
          slug: "candidate-local",
          timezone: "America/New_York",
          settings: {},
        },
      ];
    if (table === "linked_contacts") return [contact];
    if (table === "portal_accounts")
      return [{ user_id: identity, account_type: role }];
    if (table === "lesson_list_rows") return state.empty ? [] : [lesson];
    return [];
  };
  const reply = (route: Route, data: unknown, status = 200, extra = {}) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-expose-headers": "content-range",
        ...extra,
      },
      body: JSON.stringify(data),
    });
  await context.routeWebSocket("**/*", (socket) => socket.close());
  await context.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (
      !["http://127.0.0.1:4187", "http://127.0.0.1:54399"].includes(url.origin)
    )
      return route.abort();
    if (req.method() === "OPTIONS") return reply(route, null);
    if (url.pathname.startsWith("/api/")) {
      const body = req.postDataJSON() || {};
      state.commands.push(String(body.command || url.pathname));
      state.keys.push(
        String(body.idempotencyKey || req.headers()["idempotency-key"] || ""),
      );
      if (
        url.pathname === "/api/v2/lessons" &&
        body.command === "bulk_candidates"
      )
        return reply(route, {
          resource: {
            items: state.empty
              ? []
              : [
                  {
                    ...lesson,
                    studentNames: [student.full_name],
                    coachArchivedAt: null,
                  },
                ],
            count: state.empty ? 0 : 1,
            offset: 0,
            limit: 25,
          },
        });
      if (state.allowLocalMutation && url.pathname === "/api/v2/lessons") {
        if (body.command === "create")
          return reply(route, {
            resource: { ...lesson, id: "70000000-0000-4000-8000-000000000030" },
          });
        if (body.command === "update_details") {
          lesson.topic = String(body.payload.topic);
          lesson.version++;
          return reply(route, { resource: lesson });
        }
        if (body.command === "preview_bulk")
          return reply(route, {
            resource: {
              jobId,
              reviewToken,
              expiresAt: "2027-01-01T00:00:00Z",
              operation: "archive",
              scope: "selected",
              count: 1,
              eligible: 1,
              blocked: 0,
              stopsFutureGeneration: false,
              creditPolicy: "return",
              notificationPolicy: "none",
            },
          });
        if (body.command === "bulk_progress")
          return reply(route, { resource: progress() });
        if (body.command === "execute_bulk") {
          if (state.staleReview)
            return reply(
              route,
              {
                code: "CONFLICT",
                message: "Reviewed records changed; review again.",
                retryable: false,
                correlationId: "local-only",
              },
              409,
            );
          const duplicate = state.accepted;
          state.accepted = true;
          return reply(route, {
            resource: { jobId, accepted: true, duplicate },
          });
        }
      }
      if (url.pathname === "/api/invoices")
        return reply(route, { invoices: [] });
      // Any unimplemented command fails visibly; never forward it to a server.
      return reply(route, { error: "LOCAL_CONTRACT_COMMAND_DENIED" }, 403);
    }
    if (url.origin === "http://127.0.0.1:4187") return route.continue();
    state.requests.push(url.pathname);
    if (url.pathname === "/auth/v1/user") return reply(route, user);
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const rpc = url.pathname.split("/").pop();
      if (rpc === "studio_route_snapshot") {
        const domains: string[] = req.postDataJSON()?.requested_domains || [];
        return reply(route, {
          currentUserId: identity,
          membership: rows("memberships")[0] || null,
          studio: rows("studios")[0] || null,
          students: rows("students"),
          lessons: domains.some((d) => ["lessons", "booking"].includes(d))
            ? rows("lesson_list_rows")
            : [],
          linkedContacts: domains.some((d) =>
            ["identity", "households", "messaging"].includes(d),
          )
            ? rows("linked_contacts")
            : [],
        });
      }
      if (rpc === "search_material_resources")
        return reply(route, {
          items: [],
          total: 0,
          nextCursor: null,
          facets: {},
        });
      if (rpc === "student_financial_overview") return reply(route, finance());
      if (rpc === "student_workspace_summary") {
        if (state.summaryDelay)
          await new Promise((resolve) =>
            setTimeout(resolve, state.summaryDelay),
          );
        if (state.summaryFailure)
          return reply(
            route,
            { message: "Synthetic summary unavailable" },
            503,
          );
        return reply(route, {
          studentId: ids.student,
          evaluatedAt: new Date().toISOString(),
          nextLesson: state.empty
            ? null
            : {
                id: lesson.id,
                topic: lesson.topic,
                startsAt: lesson.starts_at,
              },
          latestNote: null,
          work: [],
          practice: [],
          questions: 0,
          approvals: 0,
          finance: finance(),
        });
      }
      if (rpc === "student_credit_coverage")
        return reply(route, {
          studentId: ids.student,
          evaluatedAt: new Date().toISOString(),
          previewEnable: Boolean(req.postDataJSON()?.p_preview_enable),
          settingReasonCode: null,
          lessonsVisible: true,
          summary: {
            remaining: 0,
            available: 0,
            reserved: 0,
            expired: 0,
            version: 1,
            autoApply: false,
            needsReview: false,
          },
          maintenance: null,
          items: [],
          page: req.postDataJSON()?.p_page || 1,
          pageSize: req.postDataJSON()?.p_page_size || 25,
          total: 0,
          hasMore: false,
          counts: { covered: 0, eligible: 0, uncovered: 0, reviewRequired: 0 },
        });
      if (rpc === "student_credit_history")
        return reply(route, { items: [], total: 0, page: 1, pageSize: 25 });
      return reply(route, { message: `Unimplemented local read: ${rpc}` }, 400);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.split("/").pop()!;
      let data = rows(table) as Record<string, unknown>[];
      for (const [key, value] of url.searchParams)
        if (value.startsWith("eq."))
          data = data.filter((row) => String(row[key]) === value.slice(3));
      const single = req.headers().accept?.includes("vnd.pgrst.object");
      return reply(route, single ? data[0] || null : data, 200, {
        "content-range": `0-${Math.max(0, data.length - 1)}/${data.length}`,
      });
    }
    return reply(route, { error: "LOCAL_CONTRACT_ENDPOINT_DENIED" }, 403);
  });
  return state;
}
