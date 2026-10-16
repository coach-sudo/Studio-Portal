import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import process from "node:process";
import {
  target,
  ids,
  assertConnection,
  assertIdentity,
  endpoint,
  manifestHash,
} from "./policy.mjs";
import { Journal } from "./journal.mjs";
import {
  protectedTransport,
  validateAuthorization,
  validateConfig,
  validateAuthSettings,
} from "./hosted.mjs";
import { perimeterState, privatePath } from "../protected-browser.mjs";
import { assertMode } from "../hosted-mutations.mjs";

const copy = (v) => JSON.parse(JSON.stringify(v));
const code = "unit-test-code-sha";
const receipt = () => ({
  target: copy(target),
  runId: target.run,
  manifestHash,
  codeHash: code,
  scope: "H01-H16",
  allowHostedBusinessMutations: true,
  allowCleanup: true,
  retainCoachAndAudit: true,
  approvedBy: "LOCAL TEST ONLY",
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
});
const jwt = (role) =>
  "header." +
  Buffer.from(JSON.stringify({ ref: target.project, role })).toString(
    "base64url",
  ) +
  ".local-test";
const config = () => ({
  anonKey: jwt("anon"),
  serviceKey: jwt("service_role"),
  netlifyToken: "local-test",
  managementToken: "local-test",
  database: {
    host: `db.${target.project}.supabase.co`,
    port: 5432,
    user: "postgres",
    database: "postgres",
    password: "local-test",
    ssl: { rejectUnauthorized: true },
  },
});
test("identity is exact for every project, studio, deploy, origin and run field", () => {
  assertIdentity(target);
  for (const key of Object.keys(target))
    assert.throws(() => assertIdentity({ ...target, [key]: "different" }));
});
test("hosted connection refuses production, poolers, alternate ports and TLS weakening", () => {
  assertConnection(config().database);
  for (const patch of [
    { host: "db.htwthzshhilrjtqwprlo.supabase.co" },
    { host: "127.0.0.1" },
    { host: "aws-0-us-east-1.pooler.supabase.com" },
    { port: 6543 },
    { database: "other" },
    { user: "other" },
    { ssl: { rejectUnauthorized: false } },
  ])
    assert.throws(() => assertConnection({ ...config().database, ...patch }));
});
test("config accepts only staging keys and the pinned strict TLS fields", () => {
  validateConfig(config());
  const extra = config();
  extra.database.ssl.servername = "other.example";
  assert.throws(() => validateConfig(extra));
  const wrong = config();
  wrong.serviceKey = jwt("anon");
  assert.throws(() => validateConfig(wrong));
  const provider = config();
  provider.STRIPE_SECRET_KEY = "unused-local-test";
  assert.throws(() => validateConfig(provider));
  const project = config();
  project.anonKey =
    "header." +
    Buffer.from(JSON.stringify({ ref: "other", role: "anon" })).toString(
      "base64url",
    ) +
    ".local-test";
  assert.throws(() => validateConfig(project));
});
test("no hosted approval is implied by the manifest or a stale/different receipt", () => {
  validateAuthorization(receipt(), code);
  for (const patch of [
    { allowHostedBusinessMutations: false },
    { allowCleanup: false },
    { retainCoachAndAudit: false },
    { scope: "H01" },
    { codeHash: "wrong" },
    { manifestHash: "wrong" },
    { runId: "other" },
    { expiresAt: new Date(Date.now() - 1).toISOString() },
    { expiresAt: new Date(Date.now() + 86401000).toISOString() },
  ])
    assert.throws(() =>
      validateAuthorization({ ...receipt(), ...patch }, code),
    );
});
test("Auth configuration proves disabled hooks, no SMTP/provider and exact redirect hosts", () => {
  const value = {
    site_url: target.origin,
    uri_allow_list:
      target.origin + "/auth/callback," + target.origin + "/auth/callback\\?**",
    hook_before_user_created_enabled: false,
    hook_custom_access_token_enabled: false,
    hook_password_verification_attempt_enabled: false,
    smtp_host: null,
    external_email_enabled: true,
    external_google_enabled: false,
  };
  validateAuthSettings(value);
  for (const patch of [
    { site_url: "https://portal.d-a-j.com" },
    { uri_allow_list: "https://**.netlify.app/**" },
    { hook_before_user_created_enabled: true },
    { hook_custom_access_token_enabled: undefined },
    { hook_password_verification_attempt_enabled: true },
    { hook_send_email_enabled: true },
    { smtp_host: "smtp.example.test" },
    { external_google_enabled: true },
  ])
    assert.throws(() => validateAuthSettings({ ...value, ...patch }));
  assert(
    endpoint(
      "GET",
      `https://api.supabase.com/v1/projects/${target.project}/config/auth`,
    ),
  );
  assert.equal(
    endpoint(
      "PATCH",
      `https://api.supabase.com/v1/projects/${target.project}/config/auth`,
    ),
    false,
  );
  assert.equal(
    endpoint(
      "GET",
      "https://api.supabase.com/v1/projects/htwthzshhilrjtqwprlo/config/auth",
    ),
    false,
  );
});
test("network allowlist refuses workers, providers, arbitrary previews and alternate auth IDs", () => {
  assert(endpoint("GET", target.origin + "/api/healthz"));
  assert(
    endpoint(
      "GET",
      `https://${target.project}.supabase.co/auth/v1/admin/users/${ids.coach}`,
    ),
  );
  for (const [method, url] of [
    ["POST", target.origin + "/api/v2/lessons"],
    ["POST", target.origin + "/api/e2e/fixtures"],
    ["GET", target.origin + "/.netlify/functions/calendar-worker"],
    ["POST", "https://api.stripe.com/v1/charges"],
    ["POST", "https://www.googleapis.com/calendar/v3/calendars/primary/events"],
    ["POST", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"],
    ["GET", "https://coachd-staging.netlify.app/api/healthz"],
    ["GET", "https://portal.d-a-j.com/api/healthz"],
    ["POST", `https://${target.project}.supabase.co/auth/v1/invite`],
    [
      "DELETE",
      `https://${target.project}.supabase.co/auth/v1/admin/users/11111111-1111-4111-8111-111111111111`,
    ],
    [
      "POST",
      `https://${target.project}.supabase.co/rest/v1/rpc/claim_lesson_bulk_items`,
    ],
    ["GET", target.origin + "/api/healthz?redirect=production"],
  ])
    assert.equal(endpoint(method, url), false, url);
  assert.throws(() => endpoint("GET", target.origin + "/%61pi/healthz"));
});
test("protected transport refuses unknown endpoints before a request and disables retry/redirect", async () => {
  const calls = [];
  const send = protectedTransport({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { status: () => 200, json: async () => ({ ok: true }) };
    },
  });
  await assert.rejects(
    send("POST", "https://api.stripe.com/v1/charges"),
    /Unapproved endpoint/,
  );
  assert.equal(calls.length, 0);
  await send("GET", target.origin + "/api/healthz");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.maxRedirects, 0);
  assert.equal(calls[0].options.maxRetries, 0);
});
test("transport failures never retry or expose request secrets", async () => {
  let calls = 0;
  const send = protectedTransport({
    fetch: async () => {
      calls++;
      throw Error("SECRET local-test");
    },
  });
  await assert.rejects(
    send("GET", target.origin + "/api/healthz"),
    (err) => !err.message.includes("SECRET"),
  );
  assert.equal(calls, 1);
});
test("perimeter requires exact unexpired immutable-host cookies and strips application state", () => {
  const cookie = {
    name: "nf-test",
    value: "local-test",
    domain: new URL(target.origin).hostname,
    path: "/",
    secure: true,
    httpOnly: true,
    expires: Date.now() / 1000 + 3600,
  };
  const state = perimeterState(
    {
      cookies: [cookie],
      origins: [
        {
          origin: target.origin,
          localStorage: [{ name: "session", value: "never-copy" }],
        },
      ],
    },
    target.origin,
  );
  assert.deepEqual(state.origins, []);
  assert.throws(() =>
    perimeterState(
      { cookies: [{ ...cookie, domain: ".netlify.app" }] },
      target.origin,
    ),
  );
  assert.throws(() =>
    perimeterState(
      { cookies: [{ ...cookie, expires: Date.now() / 1000 - 1 }] },
      target.origin,
    ),
  );
  assert.throws(() => privatePath(process.cwd()));
});
test("execution, explicit recovery and cleanup modes cannot silently switch run identity", () => {
  assertMode("--execute", false);
  assertMode("--resume", true);
  assertMode("--cleanup", true);
  assert.throws(() => assertMode("--execute", true));
  assert.throws(() => assertMode("--resume", false));
  assert.throws(() => assertMode("--cleanup", false));
});
test("durable journal enforces one writer, hash chain, code pin and corruption refusal", () => {
  const directory = mkdtempSync(join(tmpdir(), "studio-mutation-journal-"));
  let journal;
  try {
    journal = new Journal(directory, code);
    journal.append({ type: "prepared", name: "H01.test" });
    assert.throws(() => new Journal(directory, code));
    journal.close();
    journal = new Journal(directory, code);
    assert.equal(journal.events.length, 2);
    journal.close();
    assert.throws(() => new Journal(directory, "other-code"), /invalid/);
    const path = join(directory, "mutation-journal.jsonl");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace("H01.test", "H01.tampered"),
    );
    assert.throws(() => new Journal(directory, code), /invalid/);
  } finally {
    journal?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
