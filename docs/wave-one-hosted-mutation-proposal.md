# Proposed hosted Wave 1 mutations — approval pending

This is a prepared test package, not permission to run it. The current read-only lane cannot execute these operations. Production, providers, scheduled workers, messages, publications and new deployments stay excluded.

The [dedicated executor checkpoint](wave-one-hosted-mutation-executor.md) now implements this proposal with local validation only. Its exact supporting limits, canonical-SQL coverage boundaries, cleanup write fences and required retention of the banned new coach identity/two terminal students refine this proposal and require explicit approval. Hosted execution remains unauthorized.

## Exact scope

Run ID: `e2e-wave1-hosted-20261016-a`. Target the existing protected, unpublished deploy `6ad23d4f8b10c10447224155`, application `0b18a5a2238daa49bec1290f5884d5792f4aefc9`, Netlify `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`, Supabase `lrxrivfqjpkvygozphoz`, studio `4ceff683-e72f-4b2e-96ce-85db2dca4eb2` only.

The offline [generator](../scripts/staging/prepare-hosted-mutation-plan.mjs) contains the deterministic UUID inventory and exact case postconditions. Maximum additions: four confirmed synthetic Auth identities (new coach/student/guardian/unrelated), two student records, 13 seeded lessons plus six command-created occurrences, three package lots, 12 total lesson credits, one USD 100.00 maximum synthetic cash obligation, one pending invoice, one shared booking, one shared-prepaid fixture, one class, one note and supporting rows. No payment method or actual charge. At most 100 command requests and 20 records per bulk review. All contact emails use `.example.test`; suppress all outbound delivery.

Use new records in the existing staging studio because application server configuration pins that studio. Isolation means an explicit run-owned UUID allowlist and four **new** accounts, not a new deployment or access to existing synthetic accounts. A coach can see the studio's pre-existing synthetic students; the mutation executor must never select them. Abort if any proposed UUID already exists.

## Case inventory

| Case | Actual command/UI operation                                         | Required persisted result                                                   |
| ---- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| H01  | Grant four credits, repeat identical idempotency key                | One grant and receipt; no duplicate credit/audit                            |
| H02  | Enable auto; create three unpaid native lessons                     | Three unique reservations; 4 remaining / 3 reserved / 1 available           |
| H03  | Apply again; repeat after dropping the first transport response     | Zero newly applied, three already covered; unchanged ledger                 |
| H04  | Complete covered occurrence twice                                   | Exactly one consumption, no second debit                                    |
| H05  | Cancel with return; evaluate next uncovered lesson                  | One reversal and replacement hold; unrelated holds unchanged                |
| H06  | Reviewed reschedule within validity, then beyond expiry             | Valid hold stays; authoritative assessment governs invalid hold             |
| H07  | Convert a lesson to a three-occurrence series                       | Immediate coverage for eligible new occurrences, no redistribution          |
| H08  | Cancel one shared-booking occurrence                                | Sibling/booking valid; selected occurrence's intents only                   |
| H09  | Review ambiguous prepaid and student-scoped class changes           | Both refused with clear reasons, no financial/participant changes           |
| H10  | Preview protected pending-invoice/provider/note records and mistake | Exact frozen dependencies; no provider request                              |
| H11  | Execute eligible physical deletion twice                            | Physical removal, one immutable snapshot, protected rows untouched          |
| H12  | Archive → restore; void an eligible cancelled error                 | Student history stays; no notifications or implicit financial change        |
| H13  | Update after preview; execute mixed batch                           | Stale item conflicts; successful sibling not repeated                       |
| H14  | Reclaim expired/failed per-item lease and retry                     | Obsolete token rejected; successes unchanged; no worker endpoint invoked    |
| H15  | Revoke and restore only new guardian; read with old JWT             | Immediate RLS denial and later restored access; existing guardian untouched |
| H16  | Select across bounded pages/exclusions; refresh review/results      | Frozen exact IDs, stable replay keys and recoverable result context         |

Negative/exhausted balances, schema-trigger fault injection, large 5,000-item limits and genuine concurrent sessions are already exercised locally; do not seed a huge hosted dataset or change hosted triggers to repeat them. Provider settlement, actual sync/delivery and scheduled cadence remain separately blocked.

## Preflight, processing and recovery

Before provisioning, review a narrow seed/cleanup executor against this manifest. It must validate exact project/site/deploy identity, absence of existing planned IDs, user authorization for this run, current grants/roles, stopped builds and absent providers. The normal browser network denylist stays in place; only listed command endpoints with run-owned IDs may be added in a separate mutation configuration. APIRequestContext must inherit the exact-host perimeter and use no redirect following. Never use raw unprotected fixture fetches.

Capture hashes/counts of all 76 existing business tables and a row-level baseline for pre-existing data. Record explicit new-row IDs and each command idempotency key before sending. Do not invoke maintenance, calendar, outbox or intake workers. If a bulk job requires progress, request separate authorization for reviewed service-only claim/execute-item RPC processing under the same limits. Database side-effect intents are expected and must be included in the approval; actual delivery/synchronization is forbidden. No calendar connections, usable external IDs, OAuth credentials or live provider keys may be added.

Lost transport response: query the command receipt/job state first; replay the original key only when supported. Do not invent a fresh key. Conflict: create a new reviewed snapshot only with the original run-owned scope. Exhausted budget, unexpected existing-row change, unknown recipient, external request or permission mismatch: stop, quarantine run-owned pending intents and preserve the private journal. No automatic global cleanup or schema rollback.

## Cleanup order and proof

1. Stop test execution. Snapshot results, receipts, ledger totals, deletion snapshots and audit evidence privately. List all IDs changed by this run.
2. Suppress/cancel only run-owned undelivered outbox/calendar intents. Verify no send/sync was attempted. Do not execute delivery to clear a queue.
3. Remove run-owned fixture-only messages, note/material associations and pending invoice/settlement fixtures in FK order through the approved cleanup executor. Do not use ordinary financial reversal to pretend fixture removal is a production accounting action.
4. Remove run-owned participant/projection/lesson/booking/package/ledger fixture rows only through privileged cleanup explicitly approved for this manifest. Verify retained audit, immutable deletion snapshots and tombstones; do not disable their protections. Run-owned terminal student rows may need retention if audit refers to them.
5. Apply the reviewed narrow credit/lesson fixture cleanup only after its dependency conditions pass. Remove only the new memberships, guardian links and four Auth identities. Never remove/reset the original manual-test accounts.
6. Compare every pre-existing row with its baseline. Report intentional run-owned retained audit/receipt/tombstone rows and any remaining dependencies. Require zero deliverable run-owned outbox/projection work. Partial cleanup is a blocked result with exact remaining IDs, never an excuse for an unscoped delete or reset.

Exact approval requested later: prepare/review the dedicated executor, then provision and execute **H01–H16 within these budgets**, including their synthetic financial/lesson/bulk writes, recorded side-effect intents, service-only per-item processing and ordered cleanup/retention. Approval does not authorize providers, workers, schema changes, production or deployment. If executor review reveals wider scope, stop and present a revised concrete request.
