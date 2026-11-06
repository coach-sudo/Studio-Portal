// Test-runner only: no application RPC, hosted permission or financial constraint changes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, unlink, realpath } from "node:fs/promises";
import { assertE2ERunId } from "../src/security/e2eSafety";
import { z } from "zod";
import type { E2ERuntime } from "../e2e/support/runtime";

export const cleanupManifestSchema = z
  .object({
    runId: z.string(),
    studioId: z.literal("11111111-1111-4111-8111-111111111111"),
    lessonId: z.string().uuid(),
    studentId: z.string().uuid(),
    actorId: z.string().uuid(),
    receiptId: z.string().uuid(),
    paymentEntryId: z.string().uuid(),
    auditEventId: z.string().uuid(),
    key: z.string().uuid(),
    amountMinor: z.literal(7500),
    currency: z.literal("USD"),
    canonicalAssertionsPassed: z.literal(true),
  })
  .strict();
export type CleanupManifest = z.infer<typeof cleanupManifestSchema>;
export const cleanupManifestPath = (runId: string) =>
  `test-results/payment-receipt-${assertE2ERunId(runId)}.json`;
function fixtureId(run: string, label: string) {
  const hex = createHash("sha256").update(`${run}:${label}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function paymentFixtureCleanupSQL(
  raw: unknown,
  runtime: Pick<E2ERuntime, "runId" | "baseURL" | "ids">,
) {
  const m = cleanupManifestSchema.parse(raw);
  assertE2ERunId(m.runId);
  assert.equal(runtime.baseURL, "http://127.0.0.1:8888");
  assert.equal(m.runId, runtime.runId);
  assert.equal(m.lessonId, fixtureId(m.runId, "lessonDue"));
  assert.equal(m.studentId, fixtureId(m.runId, "operationalStudent"));
  assert.equal(m.lessonId, runtime.ids?.lessonDue);
  assert.equal(m.studentId, runtime.ids?.operationalStudent);
  // Values are strict UUID/literal/validated run IDs, never an arbitrary SQL input.
  return `begin;
do $fixture$ begin
 if (select count(*) from lesson_ops.payment_receipts where lesson_id='${m.lessonId}')<>1
 or not exists(select 1 from lesson_ops.payment_receipts r
 join public.lessons l on l.id=r.lesson_id join public.students s on s.id=r.student_id
 join public.studios studio on studio.id=r.studio_id
 join public.payment_entries e on e.id=r.payment_entry_id
 join public.audit_events a on a.id='${m.auditEventId}'
 where r.id='${m.receiptId}' and r.key='${m.key}' and r.actor_id='${m.actorId}'
 and r.lesson_id='${m.lessonId}' and r.student_id='${m.studentId}' and r.studio_id='${m.studioId}'
 and r.payment_entry_id='${m.paymentEntryId}' and r.amount_minor=${m.amountMinor} and r.currency='${m.currency}'
 and r.result->>'receiptId'=r.id::text and r.result->>'paymentEntryId'=e.id::text
 and l.student_id=r.student_id and l.studio_id=r.studio_id and l.topic='${m.runId} Payment due readiness'
 and s.studio_id=r.studio_id and s.full_name='${m.runId} Operational minor'
 and studio.slug='stage-story' and e.student_id=r.student_id and e.kind='payment'
 and e.amount_minor=r.amount_minor and e.currency=r.currency and e.external_reference='lesson-payment:'||r.id::text
 and a.entity_id=l.id and a.studio_id=r.studio_id and a.actor_id=r.actor_id and a.action='lesson.payment_recorded'
 and a.after_state->>'receiptId'=r.id::text)
 then raise exception 'E2E_PAYMENT_RECEIPT_CLEANUP_MISMATCH';end if;
 delete from lesson_ops.payment_receipts where id='${m.receiptId}' and key='${m.key}';
 if not found then raise exception 'E2E_PAYMENT_RECEIPT_CLEANUP_COUNT';end if;
end $fixture$;
select json_build_object('privateReceiptsRemoved',1,'ledgerEntriesRemoved',0,'hostedOperations',0);
commit;`;
}
export async function cleanupEphemeralPaymentReceipt(runtime: E2ERuntime) {
  let raw: string;
  try {
    raw = await readFile(cleanupManifestPath(runtime.runId), "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return;
    throw error;
  }
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.E2E_EPHEMERAL, "true");
  assert.equal(process.env.SUPABASE_URL, "http://127.0.0.1:54321");
  assert.equal(process.env.DB_CONTAINER, "supabase_db_studio-portal");
  assert.equal(process.env.GITHUB_REPOSITORY, "coach-sudo/Studio-Portal");
  assert.ok(process.env.GITHUB_WORKSPACE);
  assert.equal(
    await realpath(process.cwd()),
    await realpath(process.env.GITHUB_WORKSPACE),
  );
  const sql = paymentFixtureCleanupSQL(JSON.parse(raw), runtime);
  const query = (input: string) =>
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        "supabase_db_studio-portal",
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { input, encoding: "utf8", windowsHide: true },
    ).trim();
  assert.match(query("select version()"), /PostgreSQL 17\./);
  const result = JSON.parse(query(sql));
  assert.deepEqual(result, {
    privateReceiptsRemoved: 1,
    ledgerEntriesRemoved: 0,
    hostedOperations: 0,
  });
  await writeFile(
    `test-results/payment-receipt-cleanup-${runtime.runId}.json`,
    JSON.stringify(result, null, 2),
  );
  await unlink(cleanupManifestPath(runtime.runId));
}
