import { URL } from "node:url";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  plan,
  ids,
  authIds,
  tableNames,
  identifier,
  sha,
  owned,
  assertUndelivered,
  guardCommand,
  retained,
} from "./policy.mjs";
const caps = plan.budgets;
export async function snapshot(db, expectedSeal) {
  // One SQL read request covers the entire approved inventory in one snapshot.
  const union = tableNames
    .map(
      (t) =>
        `select '${t}' name,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) rows from ${identifier(t)} t`,
    )
    .join(" union all ");
  const { catalog, data, seal } = (
    await db.query(
      `select array(select schemaname||'.'||tablename from pg_tables where schemaname in ('public','credit_internal','lesson_ops') and tablename<>'public_endpoint_rate_limits' order by 1) catalog,(select jsonb_object_agg(name,rows) from (${union}) inventory) data${expectedSeal ? `,(${schemaSql()}) seal` : ""}`,
    )
  ).rows[0];
  assert.deepEqual(catalog, tableNames, "Schema table inventory drift");
  if (expectedSeal)
    assert.equal(seal, expectedSeal, "Schema/function/trigger drift");
  return data;
}
export const schemaSql = () => {
  const source = readFileSync(
    new URL("../combined-schema-fingerprint.sql", import.meta.url),
    "utf8",
  )
    .trim()
    .replace(/;$/, "");
  return `with source as (${source}),triggers as (select n.nspname,c.relname,t.tgname,replace(pg_get_triggerdef(t.oid),E'\\r\\n',E'\\n') definition,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','credit_internal','lesson_ops','auth') order by 1,2,3) select encode(sha256(convert_to(jsonb_build_object('catalog',source.catalog,'triggers',(select jsonb_agg(triggers) from triggers))::text,'UTF8')),'hex') digest from source`;
};
export class UiExecutor {
  constructor({
    db,
    journal,
    attest,
    http,
    auth,
    expectedSeal,
    initialBaselineHash,
    inject = async () => {},
  }) {
    Object.assign(this, {
      db,
      journal,
      attest,
      transport: http,
      auth,
      expectedSeal,
      initialBaselineHash,
      inject,
    });
    this.generated = new Set();
    this.jobs = new Map();
    this.audits = new Map();
    this.createAttempted = journal.events.some(
      (e) => e.type === "http-intent" && e.body.command === "create",
    );
    this.busy = false;
  }
  read() {
    this.journal.reserve("read", caps.readRequests);
  }
  browserRead() {
    this.read();
    assert(
      this.journal.count("read") <= caps.browserReadCeiling,
      "Browser read allowance reached; preserve remaining reads for exact cleanup",
    );
  }
  async capture() {
    this.read();
    return snapshot(this.db);
  }
  async checkpoint() {
    this.read();
    return snapshot(this.db, this.expectedSeal);
  }
  async seal() {
    this.read();
    assert.equal(
      (await this.db.query(schemaSql())).rows[0].digest,
      this.expectedSeal,
      "Schema/function/trigger drift",
    );
  }
  async initialize() {
    await this.attest();
    await this.db.query("set search_path=pg_catalog");
    await this.seal();
    this.read();
    this.primaryKeys = Object.fromEntries(
      (
        await this.db.query(
          "select n.nspname||'.'||c.relname name,jsonb_agg(a.attname order by k.n) columns from pg_constraint p join pg_class c on c.oid=p.conrelid join pg_namespace n on n.oid=c.relnamespace cross join lateral unnest(p.conkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum where p.contype='p' and n.nspname in ('public','credit_internal','lesson_ops') and c.relname<>'public_endpoint_rate_limits' group by 1 order by 1",
        )
      ).rows.map((r) => [r.name, r.columns]),
    );
    assert.deepEqual(Object.keys(this.primaryKeys).sort(), tableNames);
    const saved = this.journal.find("baseline", "initial");
    if (saved) {
      this.baseline = saved.value;
      const latest = this.journal.events.findLast(
        (e) => e.type === "committed",
      );
      this.known = latest?.snapshot || this.baseline;
      this.generated = new Set(latest?.generated || []);
      this.jobs = new Map(latest?.jobs || []);
      this.audits = new Map(latest?.audits || []);
    } else {
      this.baseline = await this.capture();
      if (this.initialBaselineHash)
        assert.equal(
          sha(this.baseline),
          this.initialBaselineHash,
          "Approved baseline changed; never rebaseline",
        );
      const raw = JSON.stringify(this.baseline);
      for (const value of [
        ...Object.values(ids),
        ...Object.values(authIds),
        plan.runId,
      ])
        assert(!raw.includes(value), "Planned identity collision");
      this.known = this.baseline;
      this.journal.append({
        type: "baseline",
        name: "initial",
        value: this.baseline,
      });
    }
    if (this.initialBaselineHash)
      assert.equal(
        sha(this.baseline),
        this.initialBaselineHash,
        "Journal baseline differs from approval",
      );
    assert(
      this.baseline["public.studios"].some((r) => r.id === plan.target.studio),
      "Intended staging studio missing",
    );
    const pending = this.journal.events.filter(
      (e) =>
        ["http-intent", "sql-intent"].includes(e.type) &&
        !this.journal.find("committed", e.name) &&
        !this.journal.find("rolled-back", e.name),
    );
    for (const p of pending) {
      const result = this.journal.find("durable-result", p.name);
      assert(
        result,
        "Unresolved command; inspect receipts/IDs, NEVER automatically resend",
      );
      assert.deepEqual(
        await this.capture(),
        result.snapshot,
        "Recovery snapshot changed",
      );
      this.journal.append({ ...result, type: "committed", recovered: true });
      this.known = result.snapshot;
      this.generated = new Set(result.generated);
      this.jobs = new Map(result.jobs);
      this.audits = new Map(result.audits || []);
    }
    this.verify(await this.capture(), false);
  }
  verify(all, adopt, cleanup = false) {
    const delta = {};
    let count = 0;
    const keys = new Set(
      this.journal.events
        .filter((e) => e.type === "row-identity")
        .map((e) => e.name),
    );
    for (const t of tableNames) {
      const base = this.baseline[t];
      const baseHashes = new Set(base.map(sha));
      for (const r of base)
        assert(
          all[t].some((x) => sha(x) === sha(r)),
          "Original business row changed: " + t,
        );
      const extra = all[t].filter((r) => !baseHashes.has(sha(r)));
      delta[t] = extra;
      for (const r of extra) {
        assert(
          owned(
            t,
            r,
            this.generated,
            this.jobs,
            this.audits,
            this.requestKeys(),
          ),
          "Unknown/unowned row: " + t,
        );
        assertUndelivered(t, r);
        count++;
        keys.add(t + ":" + this.rowKey(t, r));
      }
      if (!adopt)
        assert.deepEqual(
          all[t],
          this.known[t],
          "Concurrent writer/state drift: " + t,
        );
      if (adopt && retained.has(t))
        for (const r of this.known[t].filter((r) => !baseHashes.has(sha(r)))) {
          const key = this.rowKey(t, r);
          const next = extra.find((x) => this.rowKey(t, x) === key);
          if (!next)
            assert(
              ["public.lessons", "public.lesson_participants"].includes(t) &&
                !cleanup &&
                this.jobs.get(this.activeSql?.replace(/^process\./, ""))
                  ?.operation === "delete" &&
                this.jobs
                  .get(this.activeSql.replace(/^process\./, ""))
                  .ids.includes(t === "public.lessons" ? r.id : r.lesson_id),
              "Retained history removed: " + t,
            );
          else if (
            [
              "public.audit_events",
              "public.package_credit_entries",
              "credit_internal.credit_command_receipts",
              "lesson_ops.receipts",
              "lesson_ops.lesson_deletion_snapshots",
            ].includes(t)
          )
            assert.deepEqual(next, r, "Immutable history modified: " + t);
        }
    }
    assert(count <= caps.businessRowsPeak, "Peak row budget");
    assert(
      keys.size <= caps.cumulativeBusinessRowIdentities,
      "Cumulative row identity budget",
    );
    const limited = {
      "public.notes": 2,
      "public.materials": 1,
      "public.material_links": 1,
      "public.students": 2,
      "public.memberships": 3,
      "public.linked_contacts": 2,
      "public.student_relationships": 2,
      "public.booking_services": plan.budgets.services,
      "public.packages": plan.budgets.packageLots,
      "public.lessons": plan.budgets.lessonsTotal,
      "lesson_ops.lesson_bulk_jobs": plan.budgets.bulkReviews,
    };
    for (const [t, max] of Object.entries(limited))
      assert(delta[t].length <= max, "Record budget: " + t);
    assert(
      delta["public.package_credit_entries"]
        .filter((r) => ["purchase", "adjustment"].includes(r.kind))
        .reduce((n, r) => n + Math.max(0, r.quantity), 0) <=
        plan.budgets.creditsGranted,
      "Granted credit budget",
    );
    for (const r of [...delta["public.lessons"], ...delta["public.packages"]]) {
      assert(!r.paid_minor && !r.price_minor, "Cash/price budget");
      assert(!r.currency || r.currency === "USD");
      assert(!r.external_event_id && !r.source_external_id);
    }
    if (adopt)
      for (const key of keys)
        if (
          !this.journal.events.some(
            (e) => e.type === "row-identity" && e.name === key,
          )
        )
          this.journal.append({ type: "row-identity", name: key });
    return delta;
  }
  async before() {
    assert(!this.busy, "Concurrent executor operation");
    assert(
      !this.journal.find("cleanup-proof", "final"),
      "Completed run cannot be reused",
    );
    this.busy = true;
    try {
      await this.attest();
      this.verify(await this.checkpoint(), false);
    } catch (e) {
      this.busy = false;
      throw e;
    }
  }
  rowKey(table, row) {
    const columns = this.primaryKeys[table];
    assert(columns?.length);
    assert(columns.every((k) => row[k] !== undefined));
    return JSON.stringify(columns.map((k) => row[k]));
  }
  requestKeys() {
    return new Set(
      this.journal.events.flatMap((e) =>
        e.type === "http-intent"
          ? [
              e.body.idempotencyKey,
              ...(e.body.command === "execute_change"
                ? [
                    `occurrence:${e.body.entityId}:${e.body.expectedVersion}:cancel`,
                  ]
                : []),
            ]
          : e.type === "sql-intent"
            ? [plan.runId + ":" + e.name]
            : e.type === "rpc-intent"
              ? [e.key, e.occurrenceKey].filter(Boolean)
              : [],
      ),
    );
  }
  async finish(name, value, command) {
    const all = await this.checkpoint();
    if (command) {
      const allowed = {
        update: [
          "public.students",
          "public.audit_events",
          "public.calendar_projections",
        ],
        save_linked_contact: [
          "public.students",
          "public.linked_contacts",
          "public.student_relationships",
          "public.lesson_participants",
          "public.calendar_projections",
          "public.audit_events",
        ],
        create: [
          "public.lessons",
          "public.lesson_participants",
          "public.calendar_projections",
          "public.student_credit_accounts",
          "credit_internal.credit_coverage_jobs",
          "public.audit_events",
        ],
        update_details: [
          "public.lessons",
          "public.lesson_participants",
          "public.calendar_projections",
          "public.audit_events",
        ],
        set_total: [
          "public.packages",
          "public.package_credit_entries",
          "public.student_credit_accounts",
          "credit_internal.credit_coverage_jobs",
          "public.lessons",
          "public.lesson_participants",
          "public.audit_events",
          "credit_internal.credit_command_receipts",
        ],
        set_auto: [
          "public.packages",
          "public.package_credit_entries",
          "public.student_credit_accounts",
          "credit_internal.credit_coverage_jobs",
          "public.lessons",
          "public.lesson_participants",
          "public.audit_events",
          "credit_internal.credit_command_receipts",
        ],
        apply_upcoming: [
          "public.packages",
          "public.package_credit_entries",
          "public.student_credit_accounts",
          "credit_internal.credit_coverage_jobs",
          "public.lessons",
          "public.lesson_participants",
          "public.audit_events",
          "credit_internal.credit_command_receipts",
        ],
        preview_bulk: [
          "lesson_ops.lesson_bulk_jobs",
          "lesson_ops.lesson_bulk_items",
          "lesson_ops.lesson_bulk_requests",
        ],
        execute_bulk: [
          "lesson_ops.lesson_bulk_jobs",
          "lesson_ops.lesson_bulk_items",
          "lesson_ops.lesson_bulk_requests",
        ],
        retry_bulk: [
          "lesson_ops.lesson_bulk_jobs",
          "lesson_ops.lesson_bulk_items",
          "lesson_ops.lesson_bulk_requests",
        ],
        preview_change: [],
        execute_change: [
          "public.lessons",
          "public.lesson_participants",
          "public.package_credit_entries",
          "public.student_credit_accounts",
          "credit_internal.credit_coverage_jobs",
          "public.calendar_projections",
          "lesson_ops.effects",
          "lesson_ops.receipts",
          "public.audit_events",
        ],
      }[command];
      assert(allowed);
      for (const t of tableNames) {
        if (!allowed.includes(t))
          assert.deepEqual(
            all[t],
            this.known[t],
            "Unintended table change: " + t,
          );
        for (const r of this.known[t])
          if (
            r.id === ids["other-student"] ||
            r.student_id === ids["other-student"]
          )
            assert(
              all[t].some((x) => sha(x) === sha(r)),
              "Control student changed",
            );
      }
    }
    this.verify(all, true);
    const result = {
      type: "durable-result",
      name,
      value,
      snapshot: all,
      generated: [...this.generated],
      jobs: [...this.jobs],
      audits: [...this.audits],
    };
    this.journal.append(result);
    await this.inject("after-durable-result", name);
    this.journal.append({ ...result, type: "committed" });
    this.known = all;
    return value;
  }
  async http(name, path, body, role = "coach") {
    const done = this.journal.find("committed", name);
    if (done) {
      const original = this.journal.find("http-intent", name);
      assert.deepEqual(
        { path, body, role },
        { path: original.path, body: original.body, role: original.role },
        "Changed completed request",
      );
      return done.value;
    }
    this.journal.reserve(
      "http-business",
      plan.budgets.businessMutationRequests,
    );
    this.journal.reserve("http-total", plan.budgets.httpMutationRequests);
    guardCommand(path, body, role, this);
    assert(
      !JSON.stringify(this.baseline).includes(body.idempotencyKey),
      "Idempotency key collides with baseline",
    );
    const prior = this.journal.events.find(
      (e) =>
        e.type === "http-intent" &&
        e.body.idempotencyKey === body.idempotencyKey,
    );
    if (prior)
      assert.deepEqual(prior.body, body, "Changed payload under replay key");
    await this.before();
    this.busy = true;
    try {
      this.journal.append({ type: "http-intent", name, path, body, role });
      if (body.command === "create") this.createAttempted = true;
      const response = await this.transport(path, body, role);
      await this.inject("after-response", name);
      if (response.status >= 400) {
        assert.deepEqual(
          await this.capture(),
          this.known,
          "Failed HTTP command partially mutated records; quarantine",
        );
        this.journal.append({
          type: "rolled-back",
          name,
          status: response.status,
        });
        return response;
      }
      const r = response.body.resource;
      if (response.body.auditEventId) {
        assert.match(response.body.auditEventId, /^[a-f0-9-]{36}$/);
        assert(
          !JSON.stringify(this.baseline).includes(response.body.auditEventId),
        );
        this.audits.set(response.body.auditEventId, {
          entityId: r?.id || body.entityId || body.payload.studentId,
          ...({
            create: { action: "lesson.created", entityType: "lesson" },
            update_details: {
              action: "lesson.details_updated",
              entityType: "lesson",
            },
            update: { action: "student.updated", entityType: "student" },
            save_linked_contact: {
              action: "linked_contact.updated",
              entityType: "linked_contact",
            },
          }[body.command] || {}),
        });
      }
      if (body.command === "create") {
        assert.match(r.id, /^[a-f0-9-]{36}$/);
        assert(!Object.values(ids).includes(r.id));
        assert.equal(r.student_id, ids.student);
        assert.equal(r.studio_id, plan.target.studio);
        assert(this.generated.size === 0, "Generated lesson ceiling");
        this.generated.add(r.id);
        this.journal.append({ type: "generated-lesson", name, id: r.id });
      }
      if (body.command === "preview_bulk") {
        assert(r.jobId && r.reviewToken);
        this.read();
        const items = (
          await this.db.query(
            "select * from lesson_ops.lesson_bulk_items where job_id=$1 order by ordinal limit 14",
            [r.jobId],
          )
        ).rows;
        assert(
          items.every((i) => body.payload.selectedIds.includes(i.lesson_id)),
        );
        assert.equal(items.length, body.payload.selectedIds.length);
        assert.equal(r.count, items.length);
        this.jobs.set(r.jobId, {
          token: r.reviewToken,
          ids: body.payload.selectedIds,
          operation: body.payload.operation,
          items,
        });
      }
      return await this.finish(name, response, body.command);
    } finally {
      this.busy = false;
    }
  }
  async sql(name, work, { cleanup = false } = {}) {
    const done = this.journal.find("committed", name);
    if (done) return done.value;
    this.journal.reserve("sql", caps.canonicalSqlRequests);
    if (cleanup) this.journal.reserve("cleanup", caps.cleanupTransactions);
    await this.before();
    this.activeSql = name;
    this.busy = true;
    this.journal.append({ type: "sql-intent", name });
    let commitAttempted = false;
    await this.db.query("begin isolation level serializable");
    try {
      await this.db.query(
        `lock table ${tableNames.map(identifier).join(",")} in share row exclusive mode nowait`,
      );
      this.verify(await this.capture(), false);
      const value = await work();
      const result = {
        type: "durable-result",
        name,
        value,
        snapshot: null,
        generated: [...this.generated],
        jobs: [...this.jobs],
        audits: [...this.audits],
      };
      // A receipt and the durable local result distinguish committed SQL from a
      // lost response. The receipt is a normal retained audit row, never a bypass.
      await this.db.query(
        "insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,after_state,source) values($1,$2,'ui.acceptance.commit','student',$3,$4,$5,$6,'ui_acceptance_executor')",
        [
          plan.target.studio,
          authIds.coach,
          ids.student,
          plan.runId,
          plan.runId + ":" + name,
          { digest: sha(value) },
        ],
      );
      result.snapshot = await this.capture();
      this.verify(result.snapshot, true, cleanup);
      this.journal.append(result);
      commitAttempted = true;
      await this.db.query("commit");
      await this.inject("after-sql-commit", name);
      this.journal.append({ ...result, type: "committed" });
      this.known = result.snapshot;
      return value;
    } catch (e) {
      if (!commitAttempted) {
        await this.db.query("rollback");
        this.journal.append({ type: "rolled-back", name });
      }
      throw e;
    } finally {
      this.activeSql = undefined;
      this.busy = false;
    }
  }
  ownRows(table) {
    const base = new Set(this.baseline[table].map(sha));
    return this.known[table].filter((r) => !base.has(sha(r)));
  }
}
