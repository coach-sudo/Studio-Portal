import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import {
  target,
  ids,
  students,
  sha,
  functions,
  mutableTables,
  owned,
  assertBudget,
  retained,
  assertIdentity,
  businessRowsMaximum,
} from "./policy.mjs";
import { verifySchema } from "./seal.mjs";

const tableNames = JSON.parse(
  readFileSync(
    new URL(
      "../../../docs/wave-one-hosted-business-verification.json",
      import.meta.url,
    ),
  ),
)
  .tables.map((x) => x.table)
  .sort();
const quote = (s) => {
  assert.match(s, /^[a-z_]+$/);
  return `"${s}"`;
};
export const identifier = (t) => t.split(".").map(quote).join(".");
const serial = (s) =>
  Object.fromEntries(
    Object.entries(s).map(([t, rows]) => [t, [...rows.entries()]]),
  );
const hydrate = (s) =>
  Object.fromEntries(Object.entries(s).map(([t, rows]) => [t, new Map(rows)]));
export class Executor {
  constructor({
    db,
    journal,
    attest,
    auth,
    verifyInitialBaseline = async () => {},
    inject = () => {},
  }) {
    Object.assign(this, {
      db,
      journal,
      attest,
      auth,
      verifyInitialBaseline,
      inject,
    });
    this.generated = new Set();
    this.ownedIds = new Set(Object.values(ids));
    this.rpcCount = 0;
  }
  async snapshot() {
    const catalog = (
      await this.db.query(
        "select schemaname||'.'||tablename name from pg_tables where schemaname in ('public','credit_internal','lesson_ops') and tablename<>'public_endpoint_rate_limits' order by 1",
      )
    ).rows.map((r) => r.name);
    assert.deepEqual(catalog, tableNames, "Unexpected schema inventory");
    const data = {};
    for (const table of tableNames) {
      const keys = (
        await this.db.query(
          "select a.attname from pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum where c.conrelid=$1::regclass and c.contype='p' order by k.n",
          [table],
        )
      ).rows.map((r) => r.attname);
      assert(keys.length, "Missing table primary key");
      data[table] = new Map(
        (
          await this.db.query(
            `select to_jsonb(t) row from ${identifier(table)} t`,
          )
        ).rows.map(({ row }) => [
          JSON.stringify(keys.map((k) => row[k])),
          { hash: sha(row), row },
        ]),
      );
    }
    return data;
  }
  async initialize() {
    assertIdentity(await this.attest());
    await this.db.query("set search_path=pg_catalog");
    await verifySchema(this.db);
    assert(
      (
        await this.db.query(
          "select pg_try_advisory_lock(hashtextextended($1,0)) locked",
          [target.run],
        )
      ).rows[0].locked,
      "Concurrent executor refused",
    );
    const saved = this.journal.find("state", "baseline");
    if (saved) {
      this.baseline = hydrate(saved.snapshot);
      const last = this.journal.events.findLast((x) => x.type === "committed");
      this.known = last
        ? hydrate(last.snapshot)
        : Object.fromEntries(tableNames.map((t) => [t, new Map()]));
      this.generated = new Set(last?.generated || []);
      this.rpcCount = this.journal.events.filter(
        (x) => x.type === "command",
      ).length;
      this.ownedIds = new Set(last?.ownedIds || Object.values(ids));
      await this.recover();
      this.verify(await this.snapshot(), false);
      return;
    }
    await this.verifyInitialBaseline();
    this.baseline = await this.snapshot();
    this.known = Object.fromEntries(tableNames.map((t) => [t, new Map()]));
    // Reject deterministic IDs anywhere, including JSON/array references, before Auth or business setup.
    const forbidden = new Set(Object.values(ids));
    for (const rows of Object.values(this.baseline))
      for (const { row } of rows.values()) {
        const text = JSON.stringify(row);
        assert(
          ![...forbidden].some((id) => text.includes(id)),
          "Planned fixture ID already exists",
        );
      }
    this.journal.append({
      type: "state",
      name: "baseline",
      snapshot: serial(this.baseline),
    });
  }
  verify(current, adopt, cleanup = false) {
    const result = {};
    const refs = new Set([...this.ownedIds, ...this.generated]);
    for (const [t, rows] of Object.entries(current)) {
      const baseline = this.baseline[t];
      result[t] = new Map();
      for (const [key, value] of baseline)
        assert.equal(
          rows.get(key)?.hash,
          value.hash,
          `Pre-existing business row changed: ${t}`,
        );
      for (const [key, value] of rows)
        if (!baseline.has(key)) result[t].set(key, value);
      if (!adopt)
        assert.deepEqual(
          [...result[t]].map(([k, v]) => [k, v.hash]).sort(),
          [...this.known[t]].map(([k, v]) => [k, v.hash]).sort(),
          `Unexpected concurrent/run-owned state: ${t}`,
        );
    }
    const pending = Object.entries(result).flatMap(([t, rows]) =>
      [...rows].map(([key, value]) => ({ t, key, ...value })),
    );
    while (pending.length) {
      const before = pending.length;
      for (let n = pending.length - 1; n >= 0; n--) {
        const r = pending[n];
        if (mutableTables.has(r.t) && owned(r.t, r.row, refs)) {
          if (r.row.id) refs.add(r.row.id);
          pending.splice(n, 1);
        }
      }
      assert(
        pending.length < before,
        `Unowned or prohibited records: ${pending.map((r) => r.t).join(",")}`,
      );
    }
    if (adopt)
      for (const [table, rows] of Object.entries(this.known))
        for (const [key] of rows) {
          if (retained.has(table)) {
            assert(result[table].has(key), `Retained record removed: ${table}`);
            if (
              ![
                "lesson_ops.lesson_bulk_jobs",
                "lesson_ops.lesson_bulk_items",
              ].includes(table)
            )
              assert.equal(
                result[table].get(key).hash,
                rows.get(key).hash,
                `Immutable evidence changed: ${table}`,
              );
          } else if (!cleanup && !result[table].has(key))
            assert(
              [
                "public.lessons",
                "public.lesson_participants",
                "public.calendar_projections",
                "public.student_relationships",
              ].includes(table),
              `Unexpected removal: ${table}`,
            );
        }
    assertBudget(result, this.rpcCount);
    return result;
  }
  async recover() {
    for (const entry of this.journal.events.filter(
      (x) => x.type === "prepared",
    )) {
      if (
        (this.journal.find("committed", entry.name)?.seq ?? -1) > entry.seq ||
        (this.journal.find("rolled_back", entry.name)?.seq ?? -1) > entry.seq
      )
        continue;
      const result = this.journal.find("result", entry.name);
      const receipt = (
        await this.db.query(
          "select after_state from public.audit_events where correlation_id=$1 and action='acceptance.commit'",
          [target.run + ":executor:" + entry.name],
        )
      ).rows;
      assert(receipt.length <= 1, "Ambiguous executor commit receipt");
      if (receipt.length) {
        assert(
          result && receipt[0].after_state.digest === sha(result.result),
          "Commit without durable result; quarantine",
        );
        const next = hydrate(result.snapshot);
        this.generated = new Set(result.generated);
        this.ownedIds = new Set(result.ownedIds);
        this.rpcCount = this.journal.events.filter(
          (x) => x.type === "command",
        ).length;
        this.journal.append({ ...result, type: "committed" });
        this.known = next;
      } else this.journal.append({ type: "rolled_back", name: entry.name });
    }
  }
  async op(name, work, { cleanup = false } = {}) {
    assert.match(name, /^(seed|H(?:0[1-9]|1[0-6])|cleanup)\.[\w.-]+$/);
    const done = this.journal.find("committed", name);
    if (done) return done.result;
    assertIdentity(await this.attest());
    await verifySchema(this.db);
    this.journal.append({
      type: "prepared",
      name,
      idempotencyKey: target.run + ":" + name,
    });
    const oldGenerated = new Set(this.generated);
    let commitAttempted = false;
    await this.db.query("begin isolation level serializable");
    try {
      // Cleanup cannot race a new FK/JSON reference between its preimage read
      // and delete. Fail immediately if any staging business writer is active.
      if (cleanup)
        await this.db.query(
          `lock table ${tableNames.map(identifier).join(",")} in share row exclusive mode nowait`,
        );
      this.verify(await this.snapshot(), false);
      for (const sid of students)
        await this.db.query(
          "select id from public.students where id=$1 for update nowait",
          [sid],
        );
      await this.db.query(
        "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','service_role',true)",
        [ids.coach],
      );
      const result = (await work()) ?? null;
      await this.db.query(
        "insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,after_state) values($1,$2,'acceptance.commit','acceptance_run',$3,$4,$5,'acceptance_executor',$6)",
        [
          target.studio,
          ids.coach,
          ids.receipt,
          target.run,
          target.run + ":executor:" + name,
          { digest: sha(result) },
        ],
      );
      const snapshot = this.verify(await this.snapshot(), true, cleanup);
      const nextOwnedIds = new Set([
        ...this.ownedIds,
        ...Object.values(snapshot).flatMap((rows) =>
          [...rows.values()].map((x) => x.row.id).filter(Boolean),
        ),
      ]);
      const lessonIds = new Set(
        this.journal.events
          .filter((x) => x.type === "committed")
          .flatMap((x) => x.lessonIds || []),
      );
      for (const { row } of snapshot["public.lessons"].values())
        lessonIds.add(row.id);
      const rowKeys = new Set(
        this.journal.events
          .filter((x) => x.type === "committed")
          .flatMap((x) => x.rowKeys || []),
      );
      for (const [table, rows] of Object.entries(snapshot))
        for (const key of rows.keys()) rowKeys.add(table + ":" + key);
      assert(
        rowKeys.size <= businessRowsMaximum,
        "Cumulative business row budget exceeded",
      );
      assert(lessonIds.size <= 19, "Cumulative lesson budget exceeded");
      assert(
        [...lessonIds].filter((id) => !Object.values(ids).includes(id))
          .length <= 6,
        "Command-created lesson budget exceeded",
      );
      this.journal.append({
        type: "result",
        name,
        result,
        snapshot: serial(snapshot),
        generated: [...this.generated],
        ownedIds: [...nextOwnedIds],
        rpcCount: this.rpcCount,
        lessonIds: [...lessonIds],
        rowKeys: [...rowKeys],
      });
      await this.inject("before_commit", name);
      commitAttempted = true;
      await this.db.query("commit");
      await this.inject("after_commit", name);
      this.journal.append({
        ...this.journal.find("result", name),
        type: "committed",
      });
      this.known = snapshot;
      this.ownedIds = nextOwnedIds;
      return result;
    } catch (error) {
      await this.db.query("rollback");
      this.rpcCount = this.journal.events.filter(
        (x) => x.type === "command",
      ).length;
      this.generated = oldGenerated;
      if (!commitAttempted) this.journal.append({ type: "rolled_back", name });
      // Do not automatically resend anything. Recovery proves commit via the receipt.
      throw error;
    }
  }
  async rpc(name, fn, args) {
    assert(Object.hasOwn(functions, fn), "Unapproved RPC");
    assert.equal(args.length, functions[fn].length);
    const allowed = new Set([
      ...this.ownedIds,
      ...this.generated,
      target.studio,
    ]);
    const walk = (value) => {
      if (
        typeof value === "string" &&
        /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)
      )
        assert(allowed.has(value), "Unknown input ID");
      else if (value && typeof value === "object")
        Object.values(value).forEach(walk);
    };
    args.forEach((arg, i) => {
      if (fn !== "process_lesson_bulk_item" || i !== 1) walk(arg);
    });
    const actors = {
      command_grant_student_credits: 3,
      command_student_credit_settings: 5,
      preview_lesson_occurrence_change: 0,
      execute_lesson_occurrence_change: 0,
      preview_lesson_bulk: 0,
      execute_lesson_bulk: 0,
      retry_lesson_bulk: 0,
      lesson_bulk_progress: 0,
      lesson_bulk_candidates: 0,
    };
    if (Object.hasOwn(actors, fn))
      assert.equal(args[actors[fn]], ids.coach, "Run coach required");
    const keys = {
      command_grant_student_credits: 1,
      command_student_credit_settings: 4,
      command_complete_lesson: 3,
      execute_lesson_occurrence_change: 1,
      preview_lesson_bulk: 2,
      execute_lesson_bulk: 3,
      retry_lesson_bulk: 3,
    };
    if (Object.hasOwn(keys, fn))
      assert(
        args[keys[fn]]?.startsWith(target.run + ":"),
        "Run idempotency key required",
      );
    if (fn === "claim_lesson_bulk_items") {
      assert(
        args[1] && allowed.has(args[1]) && args[0] <= 20,
        "Scoped claim required",
      );
    }
    if (fn === "preview_lesson_bulk") {
      const p = args[3];
      assert((p.selectedIds?.length || 0) <= 20);
      assert(
        p.selectedIds?.length || students.includes(p.filter?.studentId),
        "Owned selection required",
      );
    }
    assert(++this.rpcCount <= 100, "Command budget exceeded");
    this.journal.append({
      type: "command",
      name,
      function: fn,
      idempotencyKey: Object.hasOwn(keys, fn) ? args[keys[fn]] : null,
      transactionKey: target.run + ":" + name,
      args,
    });
    await this.db.query("set local role service_role");
    let failed = false;
    try {
      const result = (
        await this.db.query(
          `select public.${fn}(${args.map((_, i) => `$${i + 1}::${functions[fn][i]}`).join(",")}) result`,
          args,
        )
      ).rows[0].result;
      if (fn === "command_create_lesson") this.generated.add(result.lesson.id);
      if (fn === "command_make_lesson_recurring") {
        const rows = (
          await this.db.query(
            "select id from public.lessons where series_id=$1",
            [result.series?.id || result.seriesId],
          )
        ).rows;
        for (const row of rows) this.generated.add(row.id);
      }
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (!failed) await this.db.query("reset role");
    }
  }
  async call(name, fn, build) {
    return this.op(name, async () => this.rpc(name, fn, await build()));
  }
  async denied(name, fn, build, pattern) {
    return this.op(name, async () => {
      await this.db.query("savepoint expected_denial");
      try {
        await this.rpc(name, fn, await build());
        throw Error("Expected denial was missing");
      } catch (error) {
        await this.db.query("rollback to savepoint expected_denial");
        assert.match(error.message, pattern);
        return { denied: true, code: error.code || "ASSERTION" };
      }
    });
  }
  async row(table, id) {
    assert(
      new Set([
        ...Object.values(ids),
        ...this.generated,
        ...Object.values(this.known).flatMap((rows) =>
          [...rows.values()].map((x) => x.row.id),
        ),
      ]).has(id),
      "Unknown record ID",
    );
    return (
      await this.db.query(
        `select to_jsonb(t) r from ${identifier(table)} t where id=$1`,
        [id],
      )
    ).rows[0]?.r;
  }
  async assert(sql, args, expected) {
    const value = (await this.db.query(sql, args)).rows[0].v;
    assert.deepEqual(value, expected);
  }
  async finishCase(name) {
    this.verify(await this.snapshot(), false);
    this.journal.append({ type: "case", name });
  }
}
