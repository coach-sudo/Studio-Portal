import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  readFileSync,
  openSync,
  closeSync,
  fsyncSync,
  writeSync,
  renameSync,
  existsSync,
  lstatSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createRequire } from "node:module";
import process from "node:process";
import { URL } from "node:url";
import {
  target,
  ids,
  users,
  email,
  endpoint,
  assertConnection,
  assertIdentity,
  manifestHash,
  sha,
} from "./policy.mjs";
import { identifier } from "./engine.mjs";
import { privatePath, perimeterState } from "../protected-browser.mjs";

export function privateDirectory(path) {
  path = privatePath(path);
  assert(!lstatSync(path).isSymbolicLink());
  assert.equal(process.platform, "win32", "Reviewed NTFS runner required");
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "$p=Get-Item -LiteralPath $env:MUTATION_PRIVATE; if($p.Attributes -band [IO.FileAttributes]::ReparsePoint){exit 1}; $u=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $bad=@((Get-Acl -LiteralPath $env:MUTATION_PRIVATE).Access | Where-Object {$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($u,'S-1-5-18')}); if($bad.Count){exit 1}",
    ],
    { stdio: "ignore", env: { ...process.env, MUTATION_PRIVATE: path } },
  );
  return path;
}
export function readSecret(path) {
  try {
    privateDirectory(path);
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw Error("Restricted input invalid; sensitive diagnostics suppressed");
  }
}
function storeSecret(path, value) {
  const temp = path + ".new";
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
}
export function validateAuthorization(receipt, codeHash) {
  assertIdentity(receipt.target);
  assert.equal(receipt.runId, target.run);
  assert.equal(receipt.manifestHash, manifestHash);
  assert.equal(receipt.codeHash, codeHash);
  assert.equal(receipt.scope, "H01-H16");
  assert.equal(receipt.allowHostedBusinessMutations, true);
  assert.equal(receipt.allowCleanup, true);
  assert.equal(receipt.retainCoachAndAudit, true);
  assert(
    receipt.approvedBy &&
      Date.parse(receipt.expiresAt) > Date.now() &&
      Date.parse(receipt.expiresAt) < Date.now() + 86400000,
    "Current, bounded written approval required",
  );
}
export function validateConfig(config) {
  assert.deepEqual(
    Object.keys(config).sort(),
    [
      "anonKey",
      "database",
      "netlifyToken",
      "managementToken",
      "serviceKey",
    ].sort(),
    "Unexpected credential/configuration fields",
  );
  for (const [key, role] of [
    ["anonKey", "anon"],
    ["serviceKey", "service_role"],
  ]) {
    const payload = JSON.parse(
      Buffer.from(config[key].split(".")[1] || "", "base64url").toString(),
    );
    assert.equal(payload.ref, target.project);
    assert.equal(payload.role, role);
  }
  assert.deepEqual(
    Object.keys(config.database).sort(),
    ["host", "port", "database", "user", "password", "ssl"].sort(),
  );
  assertConnection(config.database);
  assert.deepEqual(Object.keys(config.database.ssl), ["rejectUnauthorized"]);
  assert(
    config.database.password && config.netlifyToken && config.managementToken,
  );
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
}
export function protectedTransport(api) {
  return async (method, url, data, headers = {}) => {
    assert(endpoint(method, url), "Unapproved endpoint");
    try {
      const response = await api.fetch(url, {
        method,
        data,
        headers,
        maxRedirects: 0,
        maxRetries: 0,
        timeout: 15000,
      });
      const status = response.status();
      let body;
      try {
        body = await response.json();
      } catch {
        throw Error("JSON required");
      }
      return { status, body };
    } catch {
      throw Error(
        "Protected transport unavailable; request details suppressed",
      );
    }
  };
}
export function validateAuthSettings(config) {
  assert.equal(config.site_url, target.origin);
  assert.deepEqual(
    config.uri_allow_list
      ?.split(",")
      .map((s) => s.trim())
      .sort(),
    [
      target.origin + "/auth/callback",
      target.origin + "/auth/callback\\?**",
    ].sort(),
    "Auth redirect drift",
  );
  for (const key of [
    "hook_before_user_created_enabled",
    "hook_custom_access_token_enabled",
    "hook_password_verification_attempt_enabled",
  ])
    assert.equal(config[key], false, "Disabled Auth hooks must be proven");
  for (const [key, value] of Object.entries(config))
    if (key.startsWith("hook_") && key.endsWith("_enabled"))
      assert(value === false || value === null, "Auth hook enabled");
  assert(!config.smtp_host, "Unexpected SMTP provider");
  for (const [key, value] of Object.entries(config))
    if (
      key.startsWith("external_") &&
      key.endsWith("_enabled") &&
      key !== "external_email_enabled"
    )
      assert(value === false || value === null, "Unexpected Auth provider");
}
export async function createHosted(directory, codeHash, authorization) {
  directory = privateDirectory(directory);
  validateAuthorization(readSecret(authorization), codeHash);
  const config = readSecret(join(directory, "mutation-config.json"));
  validateConfig(config);
  const require = createRequire(
    join(privatePath(process.env.STAGING_PG_RUNTIME_DIR || ""), "package.json"),
  );
  const { Client } = require("pg");
  const db = new Client({
    ...config.database,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
    lock_timeout: 3000,
    application_name: target.run,
  });
  const { request } = await import("@playwright/test");
  const perimeter = perimeterState(
    readSecret(join(directory, "perimeter.json")),
    target.origin,
  );
  const api = await request.newContext({
    storageState: perimeter,
    ignoreHTTPSErrors: false,
  });
  let journal;
  const safe = protectedTransport(api);
  const authStatePath = join(directory, "mutation-auth.json");
  let secrets = existsSync(authStatePath) ? readSecret(authStatePath) : {};
  async function authRows() {
    return (
      await db.query(
        "select id,to_jsonb(u)-'last_sign_in_at'-'updated_at' value from auth.users u order by id",
      )
    ).rows;
  }
  const attest = async () => {
    const authConfig = await safe(
      "GET",
      `https://api.supabase.com/v1/projects/${target.project}/config/auth`,
      undefined,
      { authorization: "Bearer " + config.managementToken },
    );
    assert.equal(authConfig.status, 200);
    validateAuthSettings(authConfig.body);
    const health = await safe("GET", target.origin + "/api/healthz");
    assert.equal(health.status, 200);
    assert.equal(health.body.release?.context, "deploy-preview");
    assert.equal(health.body.release?.commit, target.application.slice(0, 12));
    const headers = { authorization: "Bearer " + config.netlifyToken };
    const site = (
      await safe(
        "GET",
        `https://api.netlify.com/api/v1/sites/${target.site}`,
        undefined,
        headers,
      )
    ).body;
    assert.equal(site.id, target.site);
    assert.equal(site.sso_login, true);
    assert.equal(site.sso_login_context, "all");
    assert.equal(site.build_settings?.stop_builds, true);
    assert.equal(site.published_deploy?.id, "6ace53e7f850061d7c49b711");
    const deploy = (
      await safe(
        "GET",
        `https://api.netlify.com/api/v1/sites/${target.site}/deploys/${target.deployment}`,
        undefined,
        headers,
      )
    ).body;
    assert.equal(deploy.id, target.deployment);
    assert.equal(deploy.site_id, target.site);
    assert.equal(deploy.state, "ready");
    assert.equal(deploy.context, "deploy-preview");
    assert.equal(deploy.published_at, null);
    const base =
      "https://api.netlify.com/api/v1/accounts/6877f0feedb69199c7837fb3/env";
    const shared = await safe("GET", base, undefined, headers);
    assert.equal(shared.status, 200);
    assert.deepEqual(shared.body, []);
    const env = await safe(
      "GET",
      base + "?site_id=" + target.site,
      undefined,
      headers,
    );
    assert.equal(env.status, 200);
    const expected = [
      "STUDIO_SLUG",
      "SUPABASE_SERVICE_ROLE_KEY",
      "VITE_SUPABASE_ANON_KEY",
      "VITE_SUPABASE_URL",
      "E2E_FIXTURE_TOKEN",
      "E2E_STUDIO_ID",
      "STUDIO_ID",
      "SUPABASE_ANON_KEY",
      "SUPABASE_URL",
      "VITE_QUERY_LAYER_V2",
    ];
    assert.deepEqual(
      env.body.map((x) => x.key).sort(),
      expected.sort(),
      "Unexpected environment/provider credential",
    );
    for (const entry of env.body) {
      assert.equal(entry.values.length, 1);
      assert.equal(entry.values[0].context, "deploy-preview");
      if (
        ["SUPABASE_SERVICE_ROLE_KEY", "E2E_FIXTURE_TOKEN"].includes(entry.key)
      ) {
        assert.equal(entry.is_secret, true);
        assert.deepEqual(entry.scopes, ["functions"]);
      }
    }
    for (const k of ["VITE_SUPABASE_URL", "SUPABASE_URL"])
      assert.equal(
        env.body.find((x) => x.key === k).values[0].value,
        `https://${target.project}.supabase.co`,
      );
    for (const k of ["STUDIO_ID", "E2E_STUDIO_ID"])
      assert.equal(
        env.body.find((x) => x.key === k).values[0].value,
        target.studio,
      );
    assert.equal(
      env.body.find((x) => x.key === "VITE_QUERY_LAYER_V2").values[0].value,
      "true",
    );
    assert(
      (
        await db.query(
          "select exists(select 1 from public.studios where id=$1) v",
          [target.studio],
        )
      ).rows[0].v,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::integer n from supabase_migrations.schema_migrations",
        )
      ).rows[0].n,
      57,
    );
    if (journal) {
      const baseline = journal.find("auth-baseline", "users");
      if (baseline) {
        const current = await authRows();
        for (const original of baseline.rows)
          assert.equal(
            sha(current.find((x) => x.id === original.id)?.value),
            original.hash,
            "Pre-existing Auth identity changed",
          );
        for (const user of current.filter(
          (x) => !baseline.rows.some((b) => b.id === x.id),
        )) {
          assert(
            users.some((role) => ids[role] === user.id),
            "Unexpected Auth identity",
          );
          assert.equal(user.value.raw_app_meta_data?.acceptanceRun, target.run);
        }
      }
    }
    return target;
  };
  const auth = {
    async prepare(e) {
      journal = e.journal;
      if (!journal.find("auth-baseline", "users")) {
        const rows = await authRows();
        assert(
          !rows.some((r) => users.some((k) => ids[k] === r.id)),
          "Planned Auth ID already exists",
        );
        journal.append({
          type: "auth-baseline",
          name: "users",
          rows: rows.map((r) => ({ id: r.id, hash: sha(r.value) })),
        });
      }
      for (const role of users) {
        await attest();
        const id = ids[role];
        const existing = await safe(
          "GET",
          `https://${target.project}.supabase.co/auth/v1/admin/users/${id}`,
          undefined,
          {
            apikey: config.serviceKey,
            authorization: "Bearer " + config.serviceKey,
          },
        );
        if (existing.status === 404) {
          assert(
            !journal.find("auth-created", role),
            "Previously created Auth identity disappeared",
          );
          const password =
            secrets[role]?.password ||
            "S!" + randomBytes(30).toString("base64url");
          secrets[role] = { password, id, email: email(role) };
          storeSecret(authStatePath, secrets);
          journal.append({ type: "auth-prepared", name: role, id });
          const r = await safe(
            "POST",
            `https://${target.project}.supabase.co/auth/v1/admin/users`,
            {
              id,
              email: email(role),
              password,
              email_confirm: true,
              app_metadata: { acceptanceRun: target.run },
            },
            {
              apikey: config.serviceKey,
              authorization: "Bearer " + config.serviceKey,
            },
          );
          assert([200, 201].includes(r.status));
          assert.equal(r.body.id, id);
          assert(r.body.email_confirmed_at);
          journal.append({ type: "auth-created", name: role, id });
        } else {
          assert.equal(existing.status, 200);
          assert(
            journal.find("auth-prepared", role),
            "Unowned pre-existing Auth identity",
          );
          assert.equal(existing.body.email, email(role));
          assert.equal(existing.body.app_metadata?.acceptanceRun, target.run);
          assert(existing.body.email_confirmed_at);
          if (!journal.find("auth-created", role))
            journal.append({
              type: "auth-created",
              name: role,
              id,
              recovered: true,
            });
        }
      }
      if (!secrets.guardian.accessToken) {
        const r = await safe(
          "POST",
          `https://${target.project}.supabase.co/auth/v1/token?grant_type=password`,
          { email: email("guardian"), password: secrets.guardian.password },
          { apikey: config.anonKey },
        );
        assert.equal(r.status, 200);
        assert.equal(r.body.user.id, ids.guardian);
        secrets.guardian.accessToken = r.body.access_token;
        storeSecret(authStatePath, secrets);
      }
    },
    async guardianRead() {
      await attest();
      const r = await safe(
        "POST",
        `https://${target.project}.supabase.co/rest/v1/rpc/student_financial_overview`,
        { p_student: ids.student },
        {
          apikey: config.anonKey,
          authorization: "Bearer " + secrets.guardian.accessToken,
        },
      );
      if (r.status === 200) {
        assert.equal(r.body.studentId, ids.student);
        return true;
      }
      assert([400, 401, 403].includes(r.status));
      assert.equal(r.body.message, "FORBIDDEN");
      return false;
    },
    async cleanup(role, e) {
      journal = e.journal;
      await attest();
      const id = ids[role];
      const headers = {
        apikey: config.serviceKey,
        authorization: "Bearer " + config.serviceKey,
      };
      const current = await safe(
        "GET",
        `https://${target.project}.supabase.co/auth/v1/admin/users/${id}`,
        undefined,
        headers,
      );
      if (current.status === 404) {
        assert(
          !journal.find("auth-created", role) ||
            (role !== "coach" && journal.find("auth-cleanup-prepared", role)),
          "Owned Auth identity unexpectedly disappeared",
        );
        if (!journal.find("auth-cleanup", role))
          journal.append({
            type: "auth-cleanup",
            name: role,
            id,
            retained: false,
            recovered: true,
          });
        return;
      }
      assert.equal(current.status, 200);
      assert(journal.find("auth-prepared", role), "Unowned Auth identity");
      assert.equal(current.body.app_metadata?.acceptanceRun, target.run);
      assert.equal(current.body.email, email(role));
      if (role === "coach" && journal.find("auth-cleanup", role)) {
        assert(Date.parse(current.body.banned_until) > Date.now());
        return;
      }
      journal.append({ type: "auth-cleanup-prepared", name: role, id });
      if (role === "coach") {
        const banned = await safe(
          "PUT",
          `https://${target.project}.supabase.co/auth/v1/admin/users/${id}`,
          { ban_duration: "876000h" },
          headers,
        );
        assert.equal(banned.status, 200);
        assert(Date.parse(banned.body.banned_until) > Date.now());
      } else {
        const r = await safe(
          "DELETE",
          `https://${target.project}.supabase.co/auth/v1/admin/users/${id}`,
          undefined,
          headers,
        );
        assert.equal(r.status, 200);
      }
      journal.append({
        type: "auth-cleanup",
        name: role,
        id,
        retained: role === "coach",
      });
    },
  };
  const verifyInitialBaseline = async () => {
    const expected = JSON.parse(
      readFileSync(
        new URL(
          "../../../docs/wave-one-hosted-business-verification.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const t of expected.tables) {
      const value = (
        await db.query(
          `select count(*)::integer n,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) hash from ${identifier(t.table)} t`,
        )
      ).rows[0];
      assert.equal(value.n, t.afterCount, "Historical baseline count changed");
      assert.equal(value.hash, t.afterHash, "Historical baseline changed");
    }
  };
  try {
    await db.connect();
    await attest();
    return {
      db,
      auth,
      attest,
      verifyInitialBaseline,
      bindJournal: (value) => {
        journal = value;
      },
      close: async () => {
        await db.end();
        await api.dispose();
      },
    };
  } catch {
    await db.end();
    await api.dispose();
    throw Error("Hosted preflight failed; no fixture created");
  }
}
