// Cleanup-only adapter. The original executor, receipt and journal remain sealed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UiExecutor } from "./ui/engine.mjs";
import { cleanup } from "./ui/fixtures.mjs";
import { plan, sha, manifestHash, authIds, identifier } from "./ui/policy.mjs";

export const recoveryCaps = Object.freeze({
  read: 300,
  sql: 60,
  cleanup: 40,
  "auth-admin": 4,
});
export function originalJournal(path, expectedExecutor) {
  const bytes = readFileSync(path),
    events = bytes.toString("utf8").trim().split("\n").map(JSON.parse);
  for (let i = 0; i < events.length; i++) {
    const { hash, ...value } = events[i];
    assert.equal(value.seq, i);
    assert.equal(value.previous, events[i - 1]?.hash || "");
    assert.equal(sha(value), hash, "Original hash chain mismatch");
  }
  assert.equal(events[0].identity.runId, plan.runId);
  assert.equal(events[0].identity.manifestHash, manifestHash);
  assert.equal(events[0].identity.executorHash, expectedExecutor);
  for (const event of events.filter((e) =>
    ["http-intent", "sql-intent"].includes(e.type),
  )) {
    assert(
      events.some(
        (e) =>
          e.name === event.name &&
          ["committed", "rolled-back"].includes(e.type),
      ),
      "Unresolved original operation: " + event.name,
    );
  }
  const baseline = events.find(
    (e) => e.type === "baseline" && e.name === "initial",
  ).value;
  assert.equal(
    Object.values(baseline).reduce((n, a) => n + a.length, 0),
    215,
  );
  return {
    events,
    baseline,
    digest: sha(bytes.toString("utf8")),
    last: events.findLast((e) => e.type === "committed"),
  };
}
/** Presents original provenance for ownership checks, charging only the new journal. */
export class RecoveryJournal {
  constructor(original, journal) {
    this.original = original;
    this.journal = journal;
  }
  get events() {
    return [...this.original.events, ...this.journal.events];
  }
  find(type, name) {
    return this.events.findLast((e) => e.type === type && e.name === name);
  }
  append(value) {
    return this.journal.append(value);
  }
  count(kind) {
    return this.journal.count(kind);
  }
  reserve(kind) {
    assert(
      Object.hasOwn(recoveryCaps, kind),
      "Operation forbidden in cleanup: " + kind,
    );
    this.journal.reserve(kind, recoveryCaps[kind]);
  }
}
export function recoveryApproval(receipt, expected, now = Date.now()) {
  assert.deepEqual(
    receipt.binding,
    expected,
    "Cleanup receipt binding changed",
  );
  assert.equal(receipt.scope, "INCOMPLETE_UI_CLEANUP_ONLY");
  assert.deepEqual(receipt.budgets, recoveryCaps);
  assert(receipt.approvedBy && receipt.approvalSourceHash);
  const issued = Date.parse(receipt.issuedAt),
    expires = Date.parse(receipt.expiresAt);
  assert(
    Number.isFinite(issued) &&
      issued <= now &&
      now < expires &&
      expires - issued <= 86400000,
    "Cleanup authorization expired/future",
  );
}
export class IncompleteRecovery extends UiExecutor {
  // The transport charges every actual SELECT, including reads inside cleanup.
  read() {}
  async http() {
    throw Error("Application/acceptance commands forbidden in cleanup");
  }
}
export async function reconcileIncompleteJobs(e) {
  await e.sql(
    "cleanup.reconcile_incomplete_jobs",
    async () => {
      let skipped = 0;
      for (const row of e.ownRows("lesson_ops.lesson_bulk_items")) {
        assert(
          !row.claim_token && !row.claim_until,
          "Active bulk lease requires investigation",
        );
        if (!["pending", "processing", "failed"].includes(row.status)) continue;
        assert(e.jobs.has(row.job_id));
        const r = await e.db.query(
          `update ${identifier("lesson_ops.lesson_bulk_items")} i set status='skipped',reason_code='synthetic_cleanup_abandoned',finished_at=now(),result=jsonb_build_object('cleanupRun',$3::text,'previousStatus',status) where id=$1 and to_jsonb(i)=$2::jsonb`,
          [row.id, JSON.stringify(row), plan.runId],
        );
        assert.equal(r.rowCount, 1, "Bulk item preimage changed");
        skipped++;
      }
      // Job.state is an acceptance flag (reviewed/running), not a terminal enum.
      // Keep all jobs/reviews/receipts intact. With no retryable items, the existing
      // status RPC derives completed and workers cannot claim further work.
      return {
        skipped,
        retainedJobs: e.ownRows("lesson_ops.lesson_bulk_jobs").map((j) => j.id),
      };
    },
    { cleanup: true },
  );
}
export async function recoverIncomplete(e) {
  assert.equal(
    e.journal.original.events.filter((x) => x.type === "case").length,
    4,
    "Unexpected original case state",
  );
  await reconcileIncompleteJobs(e);
  return cleanup(e);
}
export function assertOwnedAuth(users) {
  assert.equal(users.length, 4, "Owned Auth identity count changed");
  for (const [role, id] of Object.entries(authIds)) {
    const user = users.find((u) => u.id === id);
    assert(
      user &&
        user.email === plan.accounts[role].email &&
        user.raw_app_meta_data.acceptanceRun === plan.runId &&
        user.email_confirmed_at &&
        !user.deleted_at,
      "Owned Auth identity drift",
    );
  }
}
