import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { X509Certificate } from "node:crypto";
import {
  readPrivate,
  writePrivate,
  restricted,
  executorHash,
  sourceHash,
} from "./ui/private.mjs";
import { UiJournal } from "./ui/journal.mjs";
import {
  binding,
  connection,
  authorization,
  sha,
  plan,
  authIds,
  manifestHash,
} from "./ui/policy.mjs";
import { snapshot } from "./ui/engine.mjs";
import { schemaSeal, environmentFingerprint } from "./ui/hosted.mjs";
import { postcheck } from "./ui/postcheck.mjs";
import {
  originalJournal,
  RecoveryJournal,
  IncompleteRecovery,
  recoveryApproval,
  recoverIncomplete,
  recoveryCaps,
  assertOwnedAuth,
} from "./incomplete-ui-recovery.mjs";

export const reviewedExecutor =
  "b6a1dc4c2ece66c954340d6f3bba4a5e82f5ae442909490a0050bfa57e3d3a35";
export function recoveryCodeHash() {
  return sha(
    ["incomplete-ui-recovery.mjs", "incomplete-ui-hosted.mjs"].map((f) => ({
      file: f,
      hash: sourceHash(readFileSync(new URL(f, import.meta.url))),
    })),
  );
}
export async function hostedRecovery(
  configPath,
  directory,
  { execute = false } = {},
) {
  restricted(directory, true);
  const c = readPrivate(configPath);
  binding(c.target);
  connection(c.database);
  assert.equal(executorHash(), reviewedExecutor, "Original executor changed");
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
  assert.equal(
    new X509Certificate(readFileSync(process.env.NODE_EXTRA_CA_CERTS))
      .fingerprint256,
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
  );
  const original = originalJournal(
      join(c.directory, "ui-journal.jsonl"),
      reviewedExecutor,
    ),
    oldApproval = readPrivate(c.receipt);
  authorization(
    oldApproval,
    c.target,
    reviewedExecutor,
    Date.parse(oldApproval.issuedAt),
  ); // historical validation only
  assert.equal(sha(original.baseline), oldApproval.baselineHash);
  const j = new UiJournal(directory, reviewedExecutor, c.target),
    view = new RecoveryJournal(original, j);
  const prior = readPrivate(join(dirname(c.directory), "auth/preflight.json"));
  const receiptPath = join(directory, "cleanup-authorization.json"),
    inspectionPath = join(directory, "inspection.private.json");
  const { Client } = createRequire(join(c.pgRuntime, "package.json"))("pg");
  const db = new Client({
    ...c.database,
    connectionTimeoutMillis: 10000,
    statement_timeout: 20000,
  });
  const baseQuery = db.query.bind(db);
  db.query = async (...args) => {
    const sql = typeof args[0] === "string" ? args[0] : args[0].text;
    if (/^\s*(select|with|show)\b/i.test(sql)) view.reserve("read");
    return baseQuery(...args);
  };
  const get = async (url, token) => {
    const allowed = [
      `https://api.netlify.com/api/v1/sites/${c.target.site}`,
      `https://api.netlify.com/api/v1/sites/${c.target.site}/deploys/${c.target.deployment}`,
      `https://api.netlify.com/api/v1/accounts/6877f0feedb69199c7837fb3/env?site_id=${c.target.site}`,
      `https://api.netlify.com/api/v1/accounts/6877f0feedb69199c7837fb3/env`,
      `https://api.supabase.com/v1/projects/${c.target.project}/config/auth`,
    ];
    assert(allowed.includes(url), "Unapproved recovery endpoint");
    view.reserve("read");
    const r = await fetch(url, {
      headers: { authorization: "Bearer " + token },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    assert(r.ok, "Staging metadata read failed: " + r.status);
    return r.json();
  };
  const originals = async () => {
    const users = (
      await db.query(
        "select to_jsonb(u) row from auth.users u where not(id=any($1::uuid[])) order by id",
        [Object.values(authIds)],
      )
    ).rows.map((x) => x.row);
    // Four manual-test identities plus any previously retained H01-H16 coach
    // must match the original all-account fingerprint, not a count assumption.
    const protectedAccounts = (
      await db.query(
        "select id,email,email_confirmed_at,deleted_at,banned_until,raw_app_meta_data from auth.users where not(id=any($1::uuid[])) order by id",
        [Object.values(authIds)],
      )
    ).rows;
    assert.equal(
      sha(protectedAccounts),
      c.safety.originalAuthHash,
      "Original all-account fingerprint changed",
    );
    for (const a of prior.accounts)
      assert.equal(
        sha(users.find((u) => u.id === a.id)),
        a.rowSha256,
        "Original full Auth row changed",
      );
    const migrations = (
      await db.query(
        "select to_jsonb(m) row from supabase_migrations.schema_migrations m order by version",
      )
    ).rows.map((x) => x.row);
    assert.equal(migrations.length, 57);
    assert.equal(
      sha(migrations),
      prior.migrations.sha256,
      "Migration history changed",
    );
    return { authHash: sha(users), migrationHash: sha(migrations) };
  };
  let finalBinding,
    attestedAt = 0;
  const approval = () => {
    const r = readPrivate(receiptPath);
    recoveryApproval(r, finalBinding);
    assert.equal(r.binding.recoveryCodeHash, recoveryCodeHash());
    assert.equal(
      originalJournal(join(c.directory, "ui-journal.jsonl"), reviewedExecutor)
        .digest,
      original.digest,
      "Original journal changed",
    );
    return r;
  };
  const attest = async () => {
    if (execute) approval();
    assert(db.connection.stream.authorized, "Verified TLS required");
    await originals();
    if (Date.now() - attestedAt < 30000) return;
    const site = await get(
      `https://api.netlify.com/api/v1/sites/${c.target.site}`,
      c.netlifyToken,
    );
    assert.equal(site.id, c.target.site);
    assert.equal(site.published_deploy.id, "6ace53e7f850061d7c49b711");
    assert(site.build_settings.stop_builds);
    const env = await get(
      `https://api.netlify.com/api/v1/accounts/6877f0feedb69199c7837fb3/env?site_id=${c.target.site}`,
      c.netlifyToken,
    );
    assert.equal(
      environmentFingerprint(env),
      c.safety.environmentHash,
      "Staging environment changed",
    );
    assert(
      !env.some((v) =>
        /STRIPE|GOOGLE|GMAIL|SMTP|SENDGRID|MAILGUN|RESEND|CALENDAR_TOKEN/.test(
          v.key,
        ),
      ),
      "Unexpected provider configuration",
    );
    const shared = await get(
      "https://api.netlify.com/api/v1/accounts/6877f0feedb69199c7837fb3/env",
      c.netlifyToken,
    );
    assert.equal(shared.length, 0);
    const auth = await get(
      `https://api.supabase.com/v1/projects/${c.target.project}/config/auth`,
      c.managementToken,
    );
    assert.equal(sha(auth), c.safety.authHash, "Auth configuration changed");
    attestedAt = Date.now();
  };
  let e;
  try {
    view.reserve("read");
    await db.connect();
    await db.query("set search_path=pg_catalog");
    if (execute) {
      const saved = readPrivate(inspectionPath);
      finalBinding = { ...saved.binding, recoveryCodeHash: recoveryCodeHash() };
      approval();
    }
    const auth = {
      remove: async (role, id) => {
        approval();
        assert.equal(id, authIds[role]);
        await originals();
        const before = (
          await db.query(
            "select to_jsonb(u) row from auth.users u where id=$1",
            [id],
          )
        ).rows[0]?.row;
        const expected = readPrivate(inspectionPath).ownedAuth.find(
          (u) => u.id === id,
        );
        assert(
          expected && before && sha(before) === sha(expected),
          "Owned Auth preimage changed before cleanup",
        );
        assert.equal(before.email, plan.accounts[role].email);
        assert.equal(before.raw_app_meta_data.acceptanceRun, plan.runId);
        const method = role === "coach" ? "PUT" : "DELETE",
          url = `https://${c.target.project}.supabase.co/auth/v1/admin/users/${id}`;
        const response = await fetch(url, {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: {
            apikey: c.serviceKey,
            authorization: "Bearer " + c.serviceKey,
            "content-type": "application/json",
          },
          ...(role === "coach"
            ? { body: JSON.stringify({ ban_duration: "876000h" }) }
            : {}),
        });
        assert.equal(
          response.status,
          200,
          "Auth cleanup outcome requires exact-ID investigation",
        );
        await response.arrayBuffer();
        const after = (
          await db.query(
            "select to_jsonb(u) row from auth.users u where id=$1",
            [id],
          )
        ).rows[0]?.row;
        assert(
          role === "coach"
            ? after && Date.parse(after.banned_until) > Date.now()
            : !after,
          "Auth cleanup readback failed",
        );
      },
    };
    e = new IncompleteRecovery({
      db,
      journal: view,
      attest,
      http: async () => {
        throw Error("HTTP business operations forbidden");
      },
      auth,
      expectedSeal: schemaSeal,
      initialBaselineHash: oldApproval.baselineHash,
    });
    await e.initialize();
    if (!execute) {
      const users = (
        await db.query(
          "select to_jsonb(u) row from auth.users u where id=any($1::uuid[]) order by id",
          [Object.values(authIds)],
        )
      ).rows.map((x) => x.row);
      assertOwnedAuth(users);
      const originalProof = await originals();
      const all = await e.capture();
      e.verify(all, false);
      const result = {
        binding: {
          target: c.target,
          runId: plan.runId,
          originalExecutorHash: reviewedExecutor,
          manifestHash,
          originalJournalHash: original.digest,
          originalApprovalHash: sha(oldApproval),
          baselineHash: sha(original.baseline),
          preimageHash: sha(all),
          ownedAuthHash: sha(users),
          originalProof,
        },
        verifiedAt: new Date().toISOString(),
        snapshot: all,
        ownedAuth: users,
        knownJobs: [...e.jobs],
        generated: [...e.generated],
        originalRows: 215,
        allRows: Object.values(all).reduce((n, a) => n + a.length, 0),
      };
      assert(
        !existsSync(inspectionPath),
        "Inspection already exists; never overwrite approved preimages",
      );
      writePrivate(inspectionPath, result);
      j.append({
        type: "recovery-inspection",
        name: "verified",
        binding: result.binding,
      });
      return {
        status: "INSPECTION_PASS",
        originalRows: 215,
        allRows: result.allRows,
        originalFullAuthRowsPreserved: true,
        originalMigrations: 57,
        knownJobs: e.jobs.size,
        readCharges: j.count("read"),
        writes: 0,
      };
    }
    const saved = readPrivate(inspectionPath);
    if (!j.events.some((x) => x.type === "sql-intent"))
      assert.equal(
        sha(e.known),
        saved.binding.preimageHash,
        "Approved preimage changed",
      );
    const proof = await recoverIncomplete(e);
    const independent = await postcheck({
      db,
      baseline: original.baseline,
      retained: proof.retained,
    });
    await originals();
    const authRemaining = (
      await db.query(
        "select to_jsonb(u) row from auth.users u where id=any($1::uuid[])",
        [Object.values(authIds)],
      )
    ).rows.map((x) => x.row);
    assert.equal(authRemaining.length, 1);
    assert.equal(authRemaining[0].id, authIds.coach);
    assert(Date.parse(authRemaining[0].banned_until) > Date.now());
    const final = await snapshot(db, schemaSeal);
    e.verify(final, false);
    const result = {
      status: "CLEANUP_PASS",
      verifiedAt: new Date().toISOString(),
      runId: plan.runId,
      originalRows: 215,
      originalAuthRowsPreserved: 4,
      migrationsPreserved: 57,
      retainedByTable: Object.fromEntries(
        Object.entries(proof.retained).map(([t, v]) => [t, v.length]),
      ),
      independent,
      originalJournalUnchanged: true,
      removedAuthUsers: 3,
      bannedCoach: true,
      budgets: Object.fromEntries(
        Object.keys(recoveryCaps).map((k) => [k, j.count(k)]),
      ),
      providerCalls: 0,
      messages: 0,
      workers: 0,
    };
    writePrivate(join(directory, "cleanup-result.private.json"), {
      ...result,
      retained: proof.retained,
      final,
    });
    j.append({ type: "recovery-complete", name: "final", value: result });
    return result;
  } finally {
    await db.end().catch(() => {});
    j.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [mode, config, directory] = process.argv.slice(2);
    assert(["--inspect", "--execute"].includes(mode));
    console.log(
      JSON.stringify(
        await hostedRecovery(config, directory, {
          execute: mode === "--execute",
        }),
      ),
    );
  } catch (error) {
    console.error(JSON.stringify({ status: "STOPPED", reason: error.message }));
    process.exitCode = 1;
  }
}
