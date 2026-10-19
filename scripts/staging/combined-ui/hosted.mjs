import { URL } from "node:url";
// Future hosted adapter. Imported only by an explicitly invoked --execute lane;
// preparation and disposable validation never load credentials or contact it.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { join } from "node:path";
import { randomBytes, createHash, X509Certificate } from "node:crypto";
import { chromium, webkit } from "@playwright/test";
import {
  binding,
  authorization,
  connection,
  strict,
  sha,
  plan,
  authIds,
  candidate,
} from "./policy.mjs";
import { UiJournal } from "./journal.mjs";
import { UiExecutor } from "./engine.mjs";
import {
  restricted,
  readPrivate,
  writePrivate,
  executorHash,
} from "./private.mjs";
import { perimeterState } from "../protected-browser.mjs";
import { networkRead, sessionRequest, nodeEndpoint } from "./network.mjs";
import { UiBrowserDriver } from "./browser.mjs";
import { seed, cleanup } from "./fixtures.mjs";
import { runCases } from "./cases.mjs";
import { postcheck } from "./postcheck.mjs";

export const schemaSeal =
  "a0c65b1df65ce59082005af18d9f2b40c890b04f8be744076c7a49b3ac7ccf65";
// Netlify may reorder unchanged variables between reads. Preserve every value,
// scope, context and metadata field while making only row order irrelevant.
export const environmentFingerprint = (rows) =>
  sha([...rows].sort((a, b) => a.key.localeCompare(b.key)));
const publication = "6ace53e7f850061d7c49b711";
const account = "6877f0feedb69199c7837fb3";
function jwt(key, role) {
  assert.equal(typeof key, "string");
  const parts = key.split(".");
  assert.equal(parts.length, 3, "Legacy JWT required");
  const h = JSON.parse(Buffer.from(parts[0], "base64url")),
    p = JSON.parse(Buffer.from(parts[1], "base64url"));
  assert.equal(h.alg, "HS256");
  assert.equal(p.ref, plan.target.project);
  assert.equal(p.role, role);
  assert(p.exp * 1000 > Date.now());
  return p;
}
export function configGuard(c) {
  strict(c, [
    "target",
    "database",
    "anonKey",
    "serviceKey",
    "managementToken",
    "netlifyToken",
    "pgRuntime",
    "directory",
    "receipt",
    "perimeter",
    "artifact",
    "safety",
  ]);
  binding(c.target);
  connection(c.database);
  jwt(c.anonKey, "anon");
  jwt(c.serviceKey, "service_role");
  assert(c.managementToken && c.netlifyToken);
  assert.equal(c.safety.schemaSeal, schemaSeal);
  for (const k of [
    "authHash",
    "migrationHash",
    "originalAuthHash",
    "environmentHash",
  ])
    assert.match(c.safety[k], /^[a-f0-9]{64}$/);
  assert.equal(c.safety.protection.site, plan.target.site);
  assert.equal(c.safety.protection.kind, "team-login");
  assert.equal(c.safety.protection.scope, "all-deployments");
  assert.match(c.safety.protection.evidenceHash, /^[a-f0-9]{64}$/);
}
export async function executeHosted(configFile, { cleanupOnly = false } = {}) {
  const c = readPrivate(configFile);
  configGuard(c);
  assert(
    !process.env.NODE_TLS_REJECT_UNAUTHORIZED ||
      process.env.NODE_TLS_REJECT_UNAUTHORIZED === "1",
    "Insecure TLS environment prohibited",
  );
  assert.equal(
    new X509Certificate(readFileSync(process.env.NODE_EXTRA_CA_CERTS))
      .fingerprint256,
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
    "Reviewed Supabase CA required",
  );
  const directory = restricted(c.directory, true),
    codeHash = executorHash();
  const target = binding(c.target),
    receipt = () => readPrivate(c.receipt);
  authorization(receipt(), target, codeHash); // No network before fresh approval.
  assert(
    Date.parse(c.safety.protection.verifiedAt) <= Date.now() &&
      Date.now() - Date.parse(c.safety.protection.verifiedAt) < 600000,
    "Fresh supported all-deploy protection verification required",
  );
  const artifact = readPrivate(c.artifact);
  assert.equal(sha(artifact), target.artifactHash);
  assert.equal(artifact.candidate, candidate);
  assert.equal(artifact.release, "deploy-preview/" + candidate.slice(0, 12));
  assert.equal(artifact.functions.length, 23);
  const { Client } = createRequire(
    join(restricted(c.pgRuntime, true), "package.json"),
  )("pg");
  const db = new Client({
    ...c.database,
    connectionTimeoutMillis: 10000,
    statement_timeout: 20000,
  });
  const journal = new UiJournal(directory, codeHash, target);
  let browser,
    e,
    contexts,
    checkedAt = 0,
    authDigest,
    healthAt = 0;
  const sessionState = {
    sessionRoles: new Set(),
    logout: false,
    unrelatedFallback: false,
  };
  const raw = async (url, options = {}) => {
    authorization(receipt(), target, codeHash);
    assert(
      nodeEndpoint(options.method || "GET", url, target),
      "Off-target Node endpoint",
    );
    return globalThis.fetch(url, { ...options, redirect: "error" });
  };
  const get = async (url, token) => {
    journal.reserve("read", plan.budgets.readRequests);
    const r = await raw(url, { headers: { authorization: "Bearer " + token } });
    assert(r.ok, "Metadata read failed: " + r.status);
    return r.json();
  };
  const originalAuth = async () => {
    journal.reserve("read", plan.budgets.readRequests);
    return (
      await db.query(
        "select to_jsonb(u) value from auth.users u where not(id=any($1::uuid[])) order by id",
        [Object.values(authIds)],
      )
    ).rows;
  };
  const protectedHealth = async () => {
    perimeterState(readPrivate(c.perimeter), target.origin);
    journal.reserve("read", plan.budgets.readRequests);
    const response = await contexts.coach.request.get(
      target.origin + "/api/healthz",
      { maxRedirects: 0, maxRetries: 0 },
    );
    assert.equal(
      response.status(),
      200,
      "Valid exact-host team perimeter required BEFORE fixtures",
    );
    const h = await response.json();
    assert(
      JSON.stringify(h).includes(candidate.slice(0, 12)) &&
        JSON.stringify(h).includes("deploy-preview"),
    );
    healthAt = Date.now();
  };
  const attest = async () => {
    authorization(receipt(), target, codeHash);
    assert.deepEqual(
      readPrivate(configFile),
      c,
      "Private configuration changed",
    );
    assert(db.connection.stream.authorized, "Verified database TLS required");
    if (contexts?.coach && Date.now() - healthAt >= 30000)
      await protectedHealth();
    if (Date.now() - checkedAt < 30000) return;
    assert.equal(
      sha(await originalAuth()),
      c.safety.originalAuthHash,
      "Original Auth identities changed",
    );
    assert(
      Date.now() - Date.parse(c.safety.protection.verifiedAt) < 600000,
      "Protection proof expired; stop for reinspection",
    );
    const prefix = `https://api.netlify.com/api/v1/sites/${target.site}`;
    const site = await get(prefix, c.netlifyToken),
      deploy = await get(
        prefix + "/deploys/" + target.deployment,
        c.netlifyToken,
      );
    assert.equal(site.id, target.site);
    assert.equal(site.published_deploy.id, publication);
    assert.equal(site.build_settings.stop_builds, true);
    assert.equal(deploy.id, target.deployment);
    assert.equal(deploy.site_id, target.site);
    assert.equal(deploy.state, "ready");
    assert.equal(deploy.context, "deploy-preview");
    assert.equal(deploy.published_at, null);
    assert.equal(deploy.deploy_ssl_url, target.origin);
    assert.equal(deploy.available_functions.length, 23);
    for (const f of artifact.functions)
      assert.equal(
        deploy.available_functions.find((x) => x.n === f.name)?.d,
        f.sha256,
        "Uploaded function digest mismatch",
      );
    const env = await get(
      `https://api.netlify.com/api/v1/accounts/${account}/env?site_id=${target.site}`,
      c.netlifyToken,
    );
    assert.equal(
      environmentFingerprint(env),
      c.safety.environmentHash,
      "Preview environment changed",
    );
    const shared = await get(
      `https://api.netlify.com/api/v1/accounts/${account}/env`,
      c.netlifyToken,
    );
    assert(
      Array.isArray(shared) && shared.length === 0,
      "Shared team environment must remain empty",
    );
    assert.equal(env.length, 10);
    assert(
      env.every(
        (v) =>
          v.values.length &&
          v.values.every((x) => x.context === "deploy-preview"),
      ),
    );
    assert(
      !env.some((v) =>
        /STRIPE|GOOGLE|GMAIL|SMTP|SENDGRID|RESEND|MAILGUN/i.test(v.key),
      ),
    );
    assert.equal(
      env.find((v) => v.key === "VITE_QUERY_LAYER_V2")?.values[0]?.value,
      "true",
    );
    assert.equal(
      env.find((v) => v.key === "SUPABASE_URL")?.values[0]?.value,
      `https://${target.project}.supabase.co`,
    );
    for (const key of ["SUPABASE_SERVICE_ROLE_KEY"]) {
      const v = env.find((v) => v.key === key);
      assert(
        v?.is_secret && v.scopes.length === 1 && v.scopes[0] === "functions",
      );
    }
    const a = await get(
      `https://api.supabase.com/v1/projects/${target.project}/config/auth`,
      c.managementToken,
    );
    assert.equal(sha(a), c.safety.authHash);
    assert.equal(a.site_url, target.origin);
    assert.deepEqual(a.uri_allow_list.split(","), [
      target.origin + "/auth/callback",
      target.origin + "/auth/callback\\?**",
    ]);
    for (const [k, v] of Object.entries(a))
      if (
        (/^hook_.*enabled$/.test(k) ||
          (/^external_.*enabled$/.test(k) && k !== "external_email_enabled")) &&
        v
      )
        throw Error("Auth hook/provider enabled");
    assert(!a.smtp_host && !a.smtp_user && !a.smtp_pass);
    authDigest = sha(a);
    journal.reserve("read", plan.budgets.readRequests);
    const migrations = (
      await db.query(
        "select to_jsonb(m) value from supabase_migrations.schema_migrations m order by version",
      )
    ).rows;
    assert.equal(migrations.length, 58);
    assert.equal(sha(migrations), c.safety.migrationHash);
    for (const path of ["/", "/api/healthz"]) {
      journal.reserve("read", plan.budgets.readRequests);
      const r = await raw(target.origin + path);
      assert.equal(
        r.status,
        401,
        "Anonymous staging access must remain blocked",
      );
    }
    checkedAt = Date.now();
  };
  const admin = async (method, id, body) => {
    authorization(receipt(), target, codeHash);
    assert(Object.values(authIds).includes(id));
    if (method !== "GET")
      assert.equal(
        sha(await originalAuth()),
        c.safety.originalAuthHash,
        "Original Auth identities changed",
      );
    const response = await raw(
      `https://${target.project}.supabase.co/auth/v1/admin/users${method === "POST" ? "" : "/" + id}`,
      {
        method,
        headers: {
          apikey: c.serviceKey,
          authorization: "Bearer " + c.serviceKey,
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    // Credential validity is confirmed server-side; never log a response body.
    assert(
      ![401, 403].includes(response.status),
      "Service JWT rejected by staging Auth",
    );
    const value = await response.json();
    return { status: response.status, user: value.user || value };
  };
  const passwordFile = join(directory, "ui-passwords.json");
  let passwords;
  try {
    await db.connect();
    assert(db.connection.stream.authorized);
    await attest();
    if (existsSync(passwordFile)) passwords = readPrivate(passwordFile);
    else {
      assert(!cleanupOnly, "Missing original run credentials");
      passwords = Object.fromEntries(
        Object.keys(authIds).map((r) => [
          r,
          randomBytes(32).toString("base64url"),
        ]),
      );
      writePrivate(passwordFile, passwords);
    }
    const auth = {
      verify: async (role, a) => {
        const r = await admin("GET", a.id);
        assert.equal(r.status, 200);
        assert.equal(r.user.id, a.id);
        assert.equal(r.user.email, a.email);
        assert(r.user.email_confirmed_at && !r.user.deleted_at);
        assert.equal(r.user.app_metadata.acceptanceRun, plan.runId);
        assert(
          !r.user.banned_until || Date.parse(r.user.banned_until) < Date.now(),
        );
      },
      create: async (role, a) => {
        e.read();
        const prior = await admin("GET", a.id);
        assert.equal(prior.status, 404, "Auth ID collision");
        const r = await admin("POST", a.id, {
          id: a.id,
          email: a.email,
          password: passwords[role],
          email_confirm: true,
          app_metadata: { acceptanceRun: plan.runId },
        });
        assert.equal(r.status, 200);
        assert.equal(r.user.id, a.id);
        assert.equal(r.user.email, a.email);
        assert(r.user.email_confirmed_at);
        assert(!r.user.invited_at && !r.user.recovery_sent_at);
      },
      remove: async (role, id) => {
        const r = await admin(
          role === "coach" ? "PUT" : "DELETE",
          id,
          role === "coach" ? { ban_duration: "876000h" } : undefined,
        );
        assert.equal(r.status, 200);
      },
    };
    const perimeter = perimeterState(readPrivate(c.perimeter), target.origin);
    browser = await chromium.launch({ headless: true });
    contexts = {};
    for (const role of Object.keys(authIds))
      contexts[role] = await browser.newContext({
        storageState: perimeter,
        serviceWorkers: "block",
        timezoneId: "America/New_York",
        viewport: { width: 1440, height: 1000 },
      });
    const tokens = {};
    const http = async (path, body, role) => {
      assert(tokens[role]);
      authorization(receipt(), target, codeHash);
      const response = await contexts[role].request.post(target.origin + path, {
        data: body,
        headers: { authorization: "Bearer " + tokens[role] },
        maxRedirects: 0,
        maxRetries: 0,
      });
      return { status: response.status(), body: await response.json() };
    };
    e = new UiExecutor({
      db,
      journal,
      attest,
      http,
      auth,
      expectedSeal: schemaSeal,
      initialBaselineHash: receipt().baselineHash,
    });
    e.assets = new Set(artifact.client.map((f) => "/" + f.file));
    await e.initialize();
    if (cleanupOnly) {
      assert(
        journal.find("baseline", "initial"),
        "An existing bound run is required",
      );
      assert(
        journal.events
          .filter((x) => ["http-intent", "sql-intent"].includes(x.type))
          .every(
            (x) =>
              journal.find("committed", x.name) ||
              journal.find("rolled-back", x.name),
          ),
        "Unresolved command needs exact receipt/outcome inspection; cleanup cannot guess",
      );
      const proof =
        journal.find("cleanup-proof", "final")?.value || (await cleanup(e));
      const independent = await postcheck({
        db,
        baseline: e.baseline,
        retained: proof.retained,
        read: () => e.read(),
      });
      for (const [role, id] of Object.entries(authIds)) {
        e.read();
        const r = await admin("GET", id);
        if (role === "coach") {
          assert.equal(r.status, 200);
          assert(Date.parse(r.user.banned_until) > Date.now());
        } else assert.equal(r.status, 404);
      }
      journal.append({
        type: "independent-proof",
        name: "final",
        value: independent,
      });
      return { run: plan.runId, cleanupOnly: true, verified: true };
    }
    assert(
      !journal.events.some((x) => x.type === "session-intent"),
      "Interrupted browser sessions require reviewed recovery; never recreate sessions automatically",
    );
    if (!journal.events.some((x) => x.type === "auth-intent")) {
      e.read();
      assert.equal(
        (
          await db.query(
            "select count(*) n from auth.users where id=any($1::uuid[]) or lower(email)=any($2::text[])",
            [
              Object.values(authIds),
              Object.values(plan.accounts).map((a) => a.email),
            ],
          )
        ).rows[0].n,
        "0",
        "Planned Auth ID/email collision; no provisioning",
      );
    }
    await seed(e);
    const readRequest = async (route, role) => {
      const r = route.request(),
        body = r.method() === "POST" ? r.postDataJSON() : undefined;
      if (networkRead(r.method(), r.url(), body, target, e)) {
        e.browserRead();
        const url = new URL(r.url()),
          asset = artifact.client.find(
            (f) =>
              url.origin === target.origin && "/" + f.file === url.pathname,
          );
        if (asset) {
          const reply = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
          assert.equal(reply.status(), 200);
          assert.equal(
            createHash("sha256")
              .update(await reply.body())
              .digest("hex"),
            asset.sha256,
            "Loaded client artifact mismatch",
          );
          return route.fulfill({ response: reply });
        }
        return route.continue();
      }
      sessionRequest(
        r.method(),
        r.url(),
        body,
        target,
        role,
        passwords[role],
        sessionState,
      );
      authorization(receipt(), target, codeHash);
      journal.reserve("session", 6);
      journal.reserve("http-total", 30);
      journal.append({
        type: "session-intent",
        name: role + ":" + journal.count("session"),
        role,
      });
      const reply = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
      const data = await reply.json();
      if (reply.ok() && data.accessToken) {
        jwtSession(data.accessToken, role, target);
        tokens[role] = data.accessToken;
      }
      if (reply.ok() && data.access_token) {
        jwtSession(data.access_token, role, target);
        tokens[role] = data.access_token;
      }
      await route.fulfill({ response: reply });
    };
    const driver = new UiBrowserDriver({
      executor: e,
      contexts,
      origin: target.origin,
      readRequest,
      output: directory,
    });
    await driver.initialize();
    const renderViews = driver.views.bind(driver);
    driver.views = async (phase) => {
      // Fresh authenticated HTTP/RLS probes complement the database assertions;
      // service access is never substituted for the new portal-role tokens.
      for (const role of phase === "revoked"
        ? ["guardian"]
        : ["student", "guardian", "unrelated"]) {
        e.read();
        const denied = phase === "revoked" || role === "unrelated";
        const r = await raw(
          `https://${target.project}.supabase.co/rest/v1/rpc/student_financial_overview`,
          {
            method: "POST",
            headers: {
              apikey: c.anonKey,
              authorization: "Bearer " + tokens[role],
              "content-type": "application/json",
            },
            body: JSON.stringify({
              p_student:
                denied && role !== "guardian"
                  ? plan.records["other-student"]
                  : plan.records.student,
            }),
          },
        );
        const data = await r.json();
        if (denied) {
          assert(
            r.status >= 400 && JSON.stringify(data).includes("FORBIDDEN"),
            "Fresh portal denial required",
          );
        } else {
          assert.equal(r.status, 200);
          assert.equal(data.studentId, plan.records.student);
        }
      }
      await renderViews(phase);
      if (phase === "before-revocation") {
        assert(
          !journal.find("workspace-browser-proof", "webkit"),
          "No automatic WebKit replay",
        );
        const second = await webkit.launch({ headless: true });
        try {
          const states = {};
          for (const role of ["coach", "student", "guardian"]) {
            jwtSession(tokens[role], role, target);
            states[role] = await second.newContext({
              storageState: await contexts[role].storageState(),
              serviceWorkers: "block",
              timezoneId: "America/New_York",
              viewport: { width: 1440, height: 1000 },
            });
          }
          const other = new UiBrowserDriver({
            executor: e,
            contexts: states,
            origin: target.origin,
            readRequest,
            output: directory,
          });
          other.engine = "webkit";
          await other.initialize();
          await other.views("wave2");
          other.check();
        } finally {
          await second.close();
        }
        assert(
          journal.find("workspace-browser-proof", "chromium") &&
            journal.find("workspace-browser-proof", "webkit"),
        );
        journal.append({ type: "case", name: "WAVE2" });
      }
    };
    // Team session is verified before application sign-in; no automatic login
    // recovery, OTP, access-claim or token refresh is permitted by this lane.
    e.read();
    const health = await contexts.coach.request.get(
      target.origin + "/api/healthz",
      { maxRedirects: 0, maxRetries: 0 },
    );
    assert.equal(health.status(), 200);
    const h = await health.json();
    assert(
      JSON.stringify(h).includes(candidate.slice(0, 12)) &&
        JSON.stringify(h).includes("deploy-preview"),
    );
    for (const role of Object.keys(authIds)) {
      const p = driver.pages[role];
      await driver.goto("/login", role);
      await p.getByLabel(/Email or username/).fill(plan.accounts[role].email);
      await p.getByLabel("Password", { exact: true }).fill(passwords[role]);
      const response = p.waitForResponse(
        (r) => r.url() === target.origin + "/api/v2/auth/login",
      );
      await p.getByRole("button", { name: "Sign in", exact: true }).click();
      const login = await response;
      if (role === "unrelated") {
        assert.equal(login.status(), 403);
        // The app has no role for this identity; the fifth session request is
        // only a direct staging password session for negative RLS probes.
        sessionRequest(
          "POST",
          `https://${target.project}.supabase.co/auth/v1/token?grant_type=password`,
          { email: plan.accounts[role].email, password: passwords[role] },
          target,
          role,
          passwords[role],
          sessionState,
        );
        journal.reserve("session", 6);
        journal.reserve("http-total", 30);
        const r = await raw(
          `https://${target.project}.supabase.co/auth/v1/token?grant_type=password`,
          {
            method: "POST",
            headers: { apikey: c.anonKey, "content-type": "application/json" },
            body: JSON.stringify({
              email: plan.accounts[role].email,
              password: passwords[role],
            }),
          },
        );
        assert(r.ok);
        const s = await r.json();
        jwtSession(s.access_token, role, target);
        tokens[role] = s.access_token;
      } else {
        assert.equal(login.status(), 200);
        await p.waitForURL((u) =>
          role === "coach"
            ? u.pathname.startsWith("/coach")
            : u.pathname.startsWith("/portal"),
        );
      }
      driver.check();
    }
    await runCases(e, driver);
    driver.check();
    sessionRequest(
      "POST",
      `https://${target.project}.supabase.co/auth/v1/logout`,
      {},
      target,
      "guardian",
      passwords.guardian,
      sessionState,
    );
    journal.reserve("session", 6);
    journal.reserve("http-total", 30);
    journal.append({
      type: "session-intent",
      name: "guardian:logout",
      role: "guardian",
    });
    const logout = await raw(
      `https://${target.project}.supabase.co/auth/v1/logout`,
      {
        method: "POST",
        headers: {
          apikey: c.anonKey,
          authorization: "Bearer " + tokens.guardian,
        },
      },
    );
    assert(logout.ok);
    for (const ctx of Object.values(contexts)) await ctx.close();
    contexts = {}; // Stop UI polling before cleanup.
    const proof = await cleanup(e);
    const independent = await postcheck({
      db,
      baseline: e.baseline,
      retained: proof.retained,
      read: () => e.read(),
    });
    for (const [role, id] of Object.entries(authIds)) {
      e.read();
      const r = await admin("GET", id);
      if (role === "coach") {
        assert.equal(r.status, 200);
        assert(Date.parse(r.user.banned_until) > Date.now());
      } else assert.equal(r.status, 404);
    }
    checkedAt = 0;
    await attest();
    assert.equal(authDigest, c.safety.authHash);
    journal.append({ type: "case", name: "UI09" });
    journal.append({
      type: "independent-proof",
      name: "final",
      value: independent,
    });
    return {
      run: plan.runId,
      candidate,
      hosted: true,
      completed: true,
      tables: 76,
      budgets: Object.fromEntries(
        [
          "http-business",
          "http-total",
          "session",
          "sql",
          "read",
          "cleanup",
          "auth-admin",
        ].map((k) => [k, journal.count(k)]),
      ),
    };
  } finally {
    await browser?.close();
    await db.end();
    journal.close();
  }
}
function jwtSession(token, role, target) {
  const p = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
  assert.equal(p.sub, authIds[role]);
  assert.equal(p.role, "authenticated");
  assert.equal(p.iss, `https://${target.project}.supabase.co/auth/v1`);
  assert(p.exp * 1000 > Date.now() + 120000);
}
