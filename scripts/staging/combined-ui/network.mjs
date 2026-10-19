import { URL } from "node:url";
import assert from "node:assert/strict";
import { plan, ids, authIds, binding } from "./policy.mjs";
export function nodeEndpoint(method, value, target) {
  binding(target);
  const u = new URL(value);
  assert(
    u.protocol === "https:" &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !u.pathname.includes("%"),
  );
  const get = method === "GET";
  if (u.origin === target.origin)
    return get && ["/", "/api/healthz"].includes(u.pathname) && !u.search;
  if (u.origin === "https://api.netlify.com")
    return (
      get &&
      ((!u.search &&
        [
          "/api/v1/sites/" + target.site,
          "/api/v1/sites/" + target.site + "/deploys/" + target.deployment,
        ].includes(u.pathname)) ||
        (u.pathname === "/api/v1/accounts/6877f0feedb69199c7837fb3/env" &&
          ["", "?site_id=" + target.site].includes(u.search)))
    );
  if (u.origin === "https://api.supabase.com")
    return (
      get &&
      !u.search &&
      u.pathname === `/v1/projects/${target.project}/config/auth`
    );
  if (u.origin !== `https://${target.project}.supabase.co`) return false;
  if (u.pathname === "/auth/v1/admin/users" && !u.search)
    return method === "POST";
  if (
    !u.search &&
    Object.values(authIds).some(
      (id) => u.pathname === "/auth/v1/admin/users/" + id,
    )
  )
    return ["GET", "PUT", "DELETE"].includes(method);
  if (u.pathname === "/auth/v1/token" && u.search === "?grant_type=password")
    return method === "POST";
  if (u.pathname === "/auth/v1/logout" && !u.search) return method === "POST";
  return (
    method === "POST" &&
    !u.search &&
    [
      "student_financial_overview",
      "studio_global_search",
      "studio_record_target",
      "portal_student_contexts",
    ].some((fn) => u.pathname === "/rest/v1/rpc/" + fn)
  );
}
const reads = new Set([
  "studio_global_search",
  "studio_record_target",
  "portal_student_contexts",
  "studio_route_snapshot",
  "student_workspace_summary",
  "student_workspace_resource",
  "student_financial_overview",
  "student_credit_coverage",
  "student_credit_history",
  "search_material_resources",
  "search_material_options",
  "get_material_resource",
  "get_material_assignment",
  "search_material_collections",
  "get_material_collection",
]);
export function networkRead(method, value, body, target, state) {
  const u = new URL(value);
  assert(!u.username && !u.password && !u.hash && !u.pathname.includes("%"));
  if (u.origin === target.origin) {
    if (
      ["GET", "HEAD"].includes(method) &&
      (state.assets?.has(u.pathname) ||
        [
          "/",
          "/login",
          "/coach",
          "/coach/today",
          "/coach/students",
          "/coach/studio",
          "/coach/bookings",
          "/coach/inbox",
          "/coach/materials",
          "/coach/finance",
          "/coach/settings",
          "/portal",
          "/portal/work",
          "/portal/bookings",
          "/portal/notes",
          "/portal/payments",
          "/portal/lessons",
          "/.netlify/scripts/hud",
        ].includes(u.pathname) ||
        ["", "/household", "/payments", "/lessons", "/notes", "/work"].some(
          (s) => u.pathname === `/coach/students/${ids.student}${s}`,
        ) ||
        [
          ...plan.fixtureContent.lessons.map((l) => l.id),
          ids.unavailable,
          ...state.generated,
        ].some(
          (id) =>
            u.pathname === `/portal/lessons/${id}` ||
            u.pathname === `/coach/students/${ids.student}/lessons/${id}`,
        ))
    )
      return true;
    if (
      method === "GET" &&
      [
        "/api/healthz",
        "/api/invoices",
        "/api/v2/public/booking/services",
      ].includes(u.pathname)
    )
      return true;
    if (
      method === "GET" &&
      /^\/api\/v2\/portal\/lessons\/[a-f0-9-]{36}\/delivery$/.test(u.pathname)
    )
      return [
        ...plan.fixtureContent.lessons.map((l) => l.id),
        ...state.generated,
      ].includes(u.pathname.split("/")[5]);
    if (method === "POST" && u.pathname === "/api/v2/lessons" && !u.search) {
      const p = body?.payload;
      if (body?.command === "bulk_candidates")
        return (
          p?.filter?.studentId === ids.student &&
          p.limit <= 50 &&
          p.offset <= 20
        );
      if (body?.command === "bulk_progress")
        return state.jobs.has(p?.jobId) && p.limit <= 50 && p.offset <= 20;
      if (body?.command === "record_history")
        return (
          [
            ...plan.fixtureContent.lessons.map((l) => l.id),
            ids.unavailable,
            ...state.generated,
          ].includes(p?.lessonId) && p.limit <= 50
        );
    }
    return false;
  }
  if (u.origin !== `https://${target.project}.supabase.co`) return false;
  if (method === "GET" && u.pathname === "/auth/v1/user") return true;
  if (u.pathname.startsWith("/rest/v1/rpc/")) {
    const fn = u.pathname.split("/").pop();
    if (method !== "POST" || !reads.has(fn)) return false;
    if (
      [
        "studio_global_search",
        "studio_record_target",
        "portal_student_contexts",
      ].includes(fn)
    ) {
      if (
        body?.p_student &&
        ![ids.student, ids["other-student"], ids.unavailable].includes(
          body.p_student,
        )
      )
        return false;
      if (fn === "studio_global_search")
        return (
          typeof body?.p_query === "string" &&
          body.p_query.length <= 120 &&
          [undefined, null, 1, 2].includes(body.p_page) &&
          [
            undefined,
            null,
            "student",
            "lesson",
            "note",
            "resource",
            "booking",
          ].includes(body.p_group)
        );
      if (fn === "portal_student_contexts")
        return [undefined, 1, 2].includes(body?.p_page);
      return (
        ["student", "lesson", "note", "resource"].includes(body?.p_kind) &&
        [...Object.values(ids), ...state.generated].includes(body?.p_id)
      );
    }
    return true;
  }
  return method === "GET" && /^\/rest\/v1\/[a-z_]+$/.test(u.pathname);
}
export function sessionRequest(
  method,
  value,
  body,
  target,
  role,
  password,
  state,
) {
  const u = new URL(value),
    account = plan.accounts[role];
  assert(account);
  assert.equal(method, "POST");
  assert(!u.hash);
  if (
    u.origin === target.origin &&
    u.pathname === "/api/v2/auth/login" &&
    !u.search
  ) {
    assert.deepEqual(body, { username: account.email, password });
    assert(!state.sessionRoles.has(role), "No automatic password retry");
    state.sessionRoles.add(role);
    return "login";
  }
  if (
    u.origin === `https://${target.project}.supabase.co` &&
    u.pathname === "/auth/v1/token" &&
    u.search === "?grant_type=password" &&
    role === "unrelated"
  ) {
    assert.deepEqual(body, { email: account.email, password });
    assert(!state.unrelatedFallback);
    state.unrelatedFallback = true;
    return "unrelated-denial-session";
  }
  if (
    u.origin === `https://${target.project}.supabase.co` &&
    u.pathname === "/auth/v1/logout" &&
    role === "guardian" &&
    !state.logout
  ) {
    state.logout = true;
    return "logout";
  }
  throw Error("Session endpoint prohibited; no refresh/OTP/claim/reset flow");
}
