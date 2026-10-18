import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  candidate,
  plan,
  ids,
  authIds,
  binding,
  authorization,
  connection,
  guardCommand,
  owned,
  assertUndelivered,
  manifestHash,
} from "./policy.mjs";
import { UiJournal } from "./journal.mjs";
import { envelope } from "./cases.mjs";
import { networkRead, sessionRequest, nodeEndpoint } from "./network.mjs";
import { configGuard, schemaSeal } from "./hosted.mjs";
import { Buffer } from "node:buffer";
import { sourceHash } from "./private.mjs";
const target = {
  ...plan.target,
  candidate,
  deployment: "a".repeat(24),
  origin: "https://" + "a".repeat(24) + "--coachd-staging.netlify.app",
  artifactHash: "b".repeat(64),
};
test("executor source seal is stable across LF and CRLF checkouts", () => {
  assert.equal(
    sourceHash(Buffer.from("one\ntwo\n")),
    sourceHash(Buffer.from("one\r\ntwo\r\n")),
  );
  assert.notEqual(
    sourceHash(Buffer.from("one\ntwo\n")),
    sourceHash(Buffer.from("one\nchanged\n")),
  );
});
const receipt = () => ({
  runId: plan.runId,
  target,
  manifestHash,
  executorHash: "local-code",
  baselineHash: "c".repeat(64),
  issuedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  scope: "UI01-UI09",
  allowCleanup: true,
  approvedBy: "LOCAL TEST ONLY",
});
const state = () => ({
  generated: new Set(),
  jobs: new Map(),
  createAttempted: false,
  revokePayload: {
    contactId: ids.contact,
    email: plan.accounts.guardian.email,
    portalEnabled: false,
    canReceiveNotifications: false,
  },
});
test("new exact candidate binding accepted (offline identity only)", () =>
  binding(target));
for (const [key, value] of Object.entries({
  project: "htwthzshhilrjtqwprlo",
  site: "93829451-dbcf-4863-a07f-fa448cb17494",
  studio: authIds.coach,
  candidate: "830c762bdaf085f5e20a91f4e6a7afbef4afa627",
  origin: "https://portal.d-a-j.com",
  deployment: "6ad39275e099502cb54a8f64",
  artifactHash: "invalid",
}))
  test("reject target substitution " + key, () =>
    assert.throws(() => binding({ ...target, [key]: value })),
  );
test("approval is exact, unexpired, fresh and single-run", () => {
  authorization(receipt(), target, "local-code");
  for (const change of [
    { runId: "e2e-wave1-hosted-20261016-a" },
    { expiresAt: new Date(0).toISOString() },
    { executorHash: "changed" },
    { scope: "H01-H16" },
    { allowCleanup: false },
    { target: { ...target, studio: authIds.student } },
    { issuedAt: new Date(Date.now() + 100000).toISOString() },
    { manifestHash: "other" },
  ])
    assert.throws(() =>
      authorization({ ...receipt(), ...change }, target, "local-code"),
    );
});
test("strict verified TLS staging connection only", () => {
  const c = {
    host: "db.lrxrivfqjpkvygozphoz.supabase.co",
    port: 5432,
    user: "postgres",
    database: "postgres",
    password: "LOCAL TEST",
    ssl: { rejectUnauthorized: true },
  };
  connection(c);
  for (const change of [
    { host: "db.htwthzshhilrjtqwprlo.supabase.co" },
    { host: "127.0.0.1" },
    { host: "pooler.supabase.com" },
    { port: 6543 },
    { ssl: { rejectUnauthorized: false } },
    { ssl: { rejectUnauthorized: true, servername: "elsewhere" } },
    { database: "other" },
  ])
    assert.throws(() => connection({ ...c, ...change }));
});
test("focus-only profile guard rejects identity, delivery and foreign records", () => {
  const b = envelope(
    "profile",
    "update",
    { focusArea: plan.runId + " focus" },
    1,
    ids.student,
  );
  guardCommand("/api/v2/students", b, "coach", state());
  for (const change of [
    { entityId: ids["other-student"] },
    { payload: { ...b.payload, email: "other@example.test" } },
    { payload: { ...b.payload, portalEnabled: true } },
    { command: "invite" },
  ])
    assert.throws(() =>
      guardCommand("/api/v2/students", { ...b, ...change }, "coach", state()),
    );
});
test("contact guard permits exact owned revocation only", () => {
  const s = state(),
    b = envelope(
      "revoke",
      "save_linked_contact",
      s.revokePayload,
      1,
      ids.student,
    );
  guardCommand("/api/v2/students", b, "coach", s);
  for (const p of [
    { ...s.revokePayload, portalEnabled: true },
    { ...s.revokePayload, email: "elsewhere@example.test" },
    { ...s.revokePayload, canReceiveNotifications: true },
    { ...s.revokePayload, contactId: ids.student },
  ])
    assert.throws(() =>
      guardCommand("/api/v2/students", { ...b, payload: p }, "coach", s),
    );
});
for (const path of [
  "/api/v2/health",
  "/.netlify/functions/booking-maintenance",
  "/api/v2/admin/booking/check_conflicts",
  "/api/v2/portal/bookings/reschedule",
  "/api/v2/auth/claim-access",
  "/api/v2/packages",
  "/api/v2/finance",
  "/api/v2/settings",
  "/api/v2/messages",
  "/api/e2e/fixtures",
  "/api/v2/%6cessons",
  "/api/v2/lessons?x=1",
])
  test("reject unapproved endpoint " + path, () =>
    assert.throws(() =>
      guardCommand(path, envelope("bad", "create", {}), "coach", state()),
    ),
  );
for (const command of [
  "reschedule",
  "make_recurring",
  "cancel",
  "complete",
  "reconcile",
  "assign",
  "grant",
  "send",
  "publish",
])
  test("reject unreviewed command " + command, () =>
    assert.throws(() =>
      guardCommand(
        "/api/v2/lessons",
        envelope("bad", command, {}),
        "coach",
        state(),
      ),
    ),
  );
test("bulk preview freezes a finite owned selection, never all matching", () => {
  const p = {
    operation: "archive",
    scope: "selected",
    selectionMode: "ids",
    selectedIds: [ids["lesson-page-07"]],
    excludedIds: [],
    filter: { studentId: ids.student },
    studentContextId: ids.student,
  };
  const b = envelope("bulk", "preview_bulk", p);
  guardCommand("/api/v2/lessons", b, "coach", state());
  for (const change of [
    { scope: "series" },
    { selectionMode: "matching" },
    { selectedIds: [authIds.student] },
    { selectedIds: Array(14).fill(ids["lesson-edit"]) },
    { filter: { studentId: ids["other-student"] } },
    { wholeClass: true },
  ])
    assert.throws(() =>
      guardCommand(
        "/api/v2/lessons",
        { ...b, payload: { ...p, ...change } },
        "coach",
        state(),
      ),
    );
});
test("student, guardian and unrelated cannot submit any allowed mutation", () => {
  for (const role of ["student", "guardian", "unrelated"])
    assert.throws(() =>
      guardCommand(
        "/api/v2/credits",
        envelope("credit", "set_total", {
          studentId: ids.student,
          total: 4,
          reason: "test",
        }),
        role,
        state(),
      ),
    );
});
test("create remains single submission, with exact native date/student and no price", () => {
  const p = {
    studentId: ids.student,
    topic: plan.runId + " UI lesson",
    startsAt: plan.fixtureContent.uiCreate.startsAt,
    endsAt: plan.fixtureContent.uiCreate.endsAt,
    locationType: "in_person",
    recurrence: "none",
    studentEmail: plan.accounts.student.email,
  };
  const b = envelope("create", "create", p);
  guardCommand("/api/v2/lessons", b, "coach", state());
  assert.throws(() =>
    guardCommand("/api/v2/lessons", b, "coach", {
      ...state(),
      createAttempted: true,
    }),
  );
  for (const x of [
    { priceMinor: 0 },
    { studentId: ids["other-student"] },
    { recurrence: "weekly" },
    { locationType: "virtual" },
    { studentEmail: "original@example.test" },
  ])
    assert.throws(() =>
      guardCommand(
        "/api/v2/lessons",
        { ...b, payload: { ...p, ...x } },
        "coach",
        state(),
      ),
    );
});
test("ownership never comes from a name or run prefix", () => {
  assert(
    !owned("public.students", {
      id: authIds.student,
      studio_id: plan.target.studio,
      full_name: plan.runId,
    }),
  );
  assert(
    !owned("public.lessons", {
      id: authIds.student,
      student_id: ids.student,
      studio_id: plan.target.studio,
      topic: plan.runId,
    }),
  );
  assert(!owned("public.notes", { student_id: ids.student }));
  assert(!owned("public.studio_invoices", { student_id: ids.student }));
});
test("attempted projection and effect are never cleanup candidates", () => {
  assert.throws(() =>
    assertUndelivered("public.calendar_projections", { attempts: 1 }),
  );
  assert.throws(() =>
    assertUndelivered("lesson_ops.effects", {
      status: "processing",
      attempts: 0,
    }),
  );
  assert.throws(() =>
    assertUndelivered("public.outbox_messages", {
      attempts: 0,
      status: "sent",
      sent_at: new Date().toISOString(),
    }),
  );
});
test("private journal has exclusive lock, persistent budget, code/target fence and hash chain", () => {
  const root = mkdtempSync(join(tmpdir(), "ui-journal-"));
  const j = new UiJournal(root, "code", target);
  assert.throws(() => new UiJournal(root, "code", target));
  j.reserve("http", 1);
  assert.throws(() => j.reserve("http", 1));
  j.close();
  const next = new UiJournal(root, "code", target);
  assert.equal(next.count("http"), 1);
  next.close();
  assert.throws(() => new UiJournal(root, "changed", target));
  const content = readFileSync(join(root, "ui-journal.jsonl"), "utf8");
  writeFileSync(
    join(root, "ui-journal.jsonl"),
    content.replace('"http"', '"forged"'),
  );
  assert.throws(() => new UiJournal(root, "code", target));
});
for (const url of [
  "https://portal.d-a-j.com/",
  "https://htwthzshhilrjtqwprlo.supabase.co/rest/v1/students",
  target.origin + "/api/v2/health",
  target.origin + "/.netlify/functions/calendar-worker",
  target.origin + "/api/v2/admin/booking/bookings",
  target.origin + "/api/e2e/fixtures",
  target.origin +
    "/api/v2/portal/lessons/11111111-1111-4111-8111-111111111111/delivery",
])
  test("browser read fence: " + url, () =>
    assert.equal(networkRead("GET", url, undefined, target, state()), false),
  );
test("browser read RPC and bulk IDs are explicit", () => {
  assert(
    networkRead(
      "POST",
      `https://${target.project}.supabase.co/rest/v1/rpc/student_financial_overview`,
      { p_student: ids.student },
      target,
      state(),
    ),
  );
  assert(
    !networkRead(
      "POST",
      `https://${target.project}.supabase.co/rest/v1/rpc/claim_lesson_bulk_items`,
      {},
      target,
      state(),
    ),
  );
  assert(
    !networkRead(
      "POST",
      target.origin + "/api/v2/lessons",
      { command: "bulk_progress", payload: { jobId: ids.student, limit: 25 } },
      target,
      state(),
    ),
  );
});
test("session fence prevents refresh, repeated login, password changes and wrong identities", () => {
  const s = { sessionRoles: new Set() },
    b = { username: plan.accounts.coach.email, password: "LOCAL TEST ONLY" };
  sessionRequest(
    "POST",
    target.origin + "/api/v2/auth/login",
    b,
    target,
    "coach",
    b.password,
    s,
  );
  assert.throws(() =>
    sessionRequest(
      "POST",
      target.origin + "/api/v2/auth/login",
      b,
      target,
      "coach",
      b.password,
      s,
    ),
  );
  for (const url of [
    `https://${target.project}.supabase.co/auth/v1/token?grant_type=refresh_token`,
    target.origin + "/api/v2/auth/claim-access",
    target.origin + "/api/v2/auth/password-changed",
    `https://${target.project}.supabase.co/auth/v1/recover`,
  ])
    assert.throws(() =>
      sessionRequest("POST", url, b, target, "coach", b.password, {
        sessionRoles: new Set(),
      }),
    );
});
test("receipts require exact submitted keys and target identities", () => {
  const row = {
    studio_id: plan.target.studio,
    actor_id: authIds.coach,
    key: "reviewed:unknown",
    request: { lessonId: ids["lesson-cancel"] },
  };
  assert(!owned("lesson_ops.receipts", row));
  assert(
    owned(
      "lesson_ops.receipts",
      row,
      new Set(),
      new Map(),
      new Map(),
      new Set(["unknown"]),
    ),
  );
  assert(
    !owned(
      "lesson_ops.receipts",
      { ...row, request: { lessonId: authIds.coach } },
      new Set(),
      new Map(),
      new Map(),
      new Set(["unknown"]),
    ),
  );
});
test("Node control-plane fence rejects production, different projects, credentials APIs and providers", () => {
  for (const url of [
    "https://api.supabase.com/v1/projects/htwthzshhilrjtqwprlo/config/auth",
    "https://api.supabase.com/v1/projects/another/config/auth",
    "https://api.netlify.com/api/v1/sites/93829451-dbcf-4863-a07f-fa448cb17494",
    `https://${target.project}.supabase.co/auth/v1/admin/users/${ids.student}`,
    "https://api.stripe.com/v1/charges",
    `https://api.supabase.com/v1/projects/${target.project}/api-keys`,
  ])
    assert(!nodeEndpoint("GET", url, target));
  assert(
    nodeEndpoint(
      "GET",
      `https://api.supabase.com/v1/projects/${target.project}/config/auth`,
      target,
    ),
  );
  assert(
    !nodeEndpoint(
      "PATCH",
      `https://api.supabase.com/v1/projects/${target.project}/config/auth`,
      target,
    ),
  );
});
test("hosted configuration requires legacy staging roles and exact reviewed seals", () => {
  const jwt = (role) =>
    Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url") +
    "." +
    Buffer.from(
      JSON.stringify({ ref: plan.target.project, role, exp: 4102444800 }),
    ).toString("base64url") +
    ".LOCAL-UNSIGNED-TEST";
  const c = {
    target,
    database: {
      host: `db.${target.project}.supabase.co`,
      port: 5432,
      database: "postgres",
      user: "postgres",
      password: "LOCAL TEST ONLY",
      ssl: { rejectUnauthorized: true },
    },
    anonKey: jwt("anon"),
    serviceKey: jwt("service_role"),
    managementToken: "LOCAL TEST ONLY",
    netlifyToken: "LOCAL TEST ONLY",
    safety: {
      schemaSeal,
      authHash: "a".repeat(64),
      migrationHash: "b".repeat(64),
      originalAuthHash: "c".repeat(64),
      environmentHash: "d".repeat(64),
      protection: {
        site: target.site,
        kind: "team-login",
        scope: "all-deployments",
        evidenceHash: "e".repeat(64),
      },
    },
  };
  configGuard(c);
  for (const patch of [
    { serviceKey: "sb_secret_NOT_A_REAL_KEY" },
    { serviceKey: jwt("anon") },
    { database: { ...c.database, ssl: { rejectUnauthorized: false } } },
    { target: { ...target, project: "htwthzshhilrjtqwprlo" } },
    { safety: { ...c.safety, schemaSeal: "unreviewed" } },
  ])
    assert.throws(() => configGuard({ ...c, ...patch }));
});
