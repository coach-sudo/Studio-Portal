// Independent read-only bookend: does not import UiExecutor or cleanup code.
import assert from "node:assert/strict";
import {
  tableNames,
  identifier,
  sha,
  ids,
  authIds,
  students,
} from "./policy.mjs";
export async function postcheck({ db, baseline, retained, read = () => {} }) {
  const counts = [];
  await db.query("begin isolation level repeatable read read only");
  try {
    read();
    // Independently assemble all table rows in one repeatable-read statement;
    // 76 verified tables do not require 76 network round trips.
    const inventory = (
      await db.query(
        tableNames
          .map(
            (table) =>
              `select '${table}' name,coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) rows from ${identifier(table)} r`,
          )
          .join(" union all "),
      )
    ).rows;
    for (const table of tableNames) {
      const rows = inventory.find((r) => r.name === table).rows;
      const old = baseline[table].map(sha),
        allowed = (retained[table] || []).map((r) => r.sha256);
      const observed = rows.map(sha);
      assert.equal(
        observed.length,
        old.length + allowed.length,
        "Postcheck row count: " + table,
      );
      assert.deepEqual(
        [...observed].sort(),
        [...old, ...allowed].sort(),
        "Independent fingerprint mismatch: " + table,
      );
      counts.push({
        table,
        baseline: old.length,
        retained: allowed.length,
        unchanged: true,
      });
    }
    read();
    const terminals = (
      await db.query(
        "select id,status,deleted_at,user_id,portal_enabled from public.students where id=any($1::uuid[])",
        [students],
      )
    ).rows;
    assert.equal(terminals.length, 2);
    assert(
      terminals.every(
        (r) =>
          r.status === "inactive" &&
          r.deleted_at &&
          !r.user_id &&
          !r.portal_enabled,
      ),
    );
    read();
    assert.equal(
      Number(
        (
          await db.query(
            "select count(*) n from public.lessons where student_id=any($1::uuid[]) and status='scheduled'",
            [students],
          )
        ).rows[0].n,
      ),
      0,
    );
    read();
    assert.equal(
      Number(
        (
          await db.query(
            "select count(*) n from public.memberships where user_id=any($1::uuid[])",
            [Object.values(authIds)],
          )
        ).rows[0].n,
      ),
      0,
    );
    read();
    assert.equal(
      Number(
        (
          await db.query(
            "select count(*) n from public.student_credit_accounts where student_id=any($1::uuid[]) and auto_apply is distinct from false",
            [students],
          )
        ).rows[0].n,
      ),
      0,
    );
    read();
    assert.equal(
      Number(
        (
          await db.query(
            "select count(*) n from lesson_ops.lesson_bulk_items i join lesson_ops.lesson_bulk_jobs j on j.id=i.job_id where j.actor_id=$1 and (i.claim_token is not null or i.claim_until is not null or j.state='running' and i.status in ('pending','processing','failed'))",
            [authIds.coach],
          )
        ).rows[0].n,
      ),
      0,
    );
    return {
      tables: counts,
      originalRowsUnchanged: true,
      terminalStudents: students,
      zeroMemberships: true,
      zeroActiveLessons: true,
      zeroAutomaticCoverage: true,
      zeroRunnableBulkItems: true,
      retainedPackage: ids.package,
    };
  } finally {
    await db.query("rollback");
  }
}
