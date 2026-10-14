# PR 1.4 — Bulk lesson backend and safe physical deletion

## Dependency and release boundary

Branch `codex/bulk-lesson-management` starts at the verified PR #38 head **`c894f7f51f26aae0e9c396a4d791d2bbc0c1a545`** and targets `codex/occurrence-safe-lesson-changes`. The chain is #36 (`f99f8cc0b7ae209e27562014e0743f39052f1dad`) → #37 (`0badcc648ec715e20c2be7849d0bdbd8ec0955e0`) → #38 → PR 1.4. All three dependencies remain open drafts. Main remains `6df35d700cc13d60ceab3e92293635575479ec4d`; no dependency migration is assumed deployed.

Sources of truth: [master plan §7](studio-portal-modernization-master-plan.md), [occurrence safety](occurrence-safe-lesson-changes.md), [credit reliability](credit-lifecycle-reliability.md). Migration `20261014203257_bulk_lesson_management.sql` was generated with the Supabase CLI and is additive. It does not delete, archive, void, or financially change existing lessons. Historical migrations are untouched.

Commits and draft title use `[skip netlify]`. Checks run on isolated local Supabase/Netlify infrastructure in GitHub CI. Production migration, merge, publication, live deletion/reconciliation, payment, and outbound communication remain unauthorized. Implementation stops at draft review.

## Operations and eligibility

| Operation          | Behavior                                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cancel             | Calls PR #38's existing occurrence mutator and assessment, with its settlement, invoice, class, shared-booking, ledger, audit and notification protections. Credit recovery intent uses PR #37.                                                             |
| Archive            | Terminal records only; writes separate coach-view metadata. Lifecycle, payments, student history, calendar and messages remain unchanged.                                                                                                                   |
| Restore            | Reverses archive metadata through a new reviewed operation.                                                                                                                                                                                                 |
| Void               | Cancelled erroneous records only, with no unresolved financial obligation. Stores inspectable void metadata and preserves notes, assignments, material links, ledgers and payments.                                                                         |
| Permanently delete | Physically removes an eligible native scheduled/cancelled mistake. Never substitutes archive for delete. Stores immutable original details, permitted scaffolding, actor, studio, job and reason before removal, in the same transaction as retained audit. |

Deletion rejects completed/late-cancelled, provider/import identity/history, packages and **any** credit-ledger history, meaningful paid/waived/refunded/partial state, invoices/checkouts/settlements, bookings/classes/offerings, authored content, associations, communication, sync conflicts, external calendar identity and any claimed/attempted projection.

Catalog assessment checks actual lesson foreign keys and public UUID, UUID-array and recursively nested JSON references, including object keys and case-insensitive UUID strings. Dependencies are counted and fingerprinted; raw referenced records are not returned. Audit history and frozen bulk review records are retained. Existing occurrence notification intents are dependencies. Only explicitly verified creation-generated own-student participants and untouched queued calendar projections qualify as removable scaffolding. Existing unmarked participants are conservatively blocked because their creation provenance cannot be proved; no historical rows are retroactively marked safe.

Scaffolding is removed explicitly before the lesson. Parent locks fence foreign-key inserts. Deletion also takes short-lived table locks on non-FK JSON/array writers, and tombstone triggers prevent delayed references to deleted lessons after commit. Lock timeout/deadlock is a recoverable item failure, never permission to weaken the dependency check. New public reference columns are included by the catalog scan; future schema migrations must also maintain tombstone fencing and regression coverage.

Normal coach lists use the authorized visibility predicate through both the route snapshot and an invoker-security list view. Portal roles retain historical lesson rows; coach administrative history can inspect archive/void metadata and deleted snapshots without exposing private tables.

## Review and scopes

Default scope is `selected`. Explicit `future` and `series` expand anchor lessons into actual IDs before approval. Student context is enforced, including student filters; whole-class mutations require explicit studio scope. Expanded cancellation stops generation only after explicit execution approval, with a locked series/occurrence snapshot recheck. A newly generated occurrence invalidates the series review instead of silently joining the batch. Protected scheduled occurrences block stopping that series; protected terminal history remains skipped.

Reviews persist the operation, reason, scope, frozen IDs/versions, actor/studio, filter/view/page context, exclusions, consequence assessment, dependency fingerprints, token, and a 30-minute expiry. The maximum is **5,000 actual reviewed records**. Matching retrieval probes 5,001 to reject oversize selections without truncating. Explicit IDs, exclusions and expanded results have the same cap. Read pages are 1–100 items; worker claims are 1–25.

## PR 1.5 request/response contract

All calls use the existing authenticated `POST /api/v2/lessons` command envelope (`idempotencyKey`, `reason`, `expectedVersion: 0`, `payload`). The coach actor comes from server authentication. Job reads are bound to their owning coach and current studio membership. RPCs and raw job/snapshot tables are not callable/readable by portal clients.

| Command           | Payload                                                                                                          | Result                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bulk_candidates` | `{filter, offset, limit}`                                                                                        | Exact server count and a bounded, stable chronological candidate page.                                                                                                                    |
| `preview_bulk`    | `{operation, scope, selectionMode, selectedIds?, excludedIds, filter, studentContextId?, wholeClass, useCredit}` | `{jobId, reviewToken, expiresAt, count, eligible, blocked, operation, scope, stopsFutureGeneration, creditPolicy, notificationPolicy}`. Fetch every review page needed before confirming. |
| `execute_bulk`    | `{jobId, reviewToken}`                                                                                           | Durable acceptance `{jobId, accepted, duplicate}`. Acceptance is distinct from per-record success and external synchronization.                                                           |
| `bulk_progress`   | `{jobId, offset, limit}`                                                                                         | Review context, state, counts, frozen assessments, per-item status/reason/result/attempts and retryability.                                                                               |
| `retry_bulk`      | `{jobId, reviewToken}`                                                                                           | Count of failed items queued again; original approval and fingerprint still apply.                                                                                                        |
| `record_history`  | `{lessonId}`                                                                                                     | Authorized lesson, management state, deletion snapshot and retained lesson audit.                                                                                                         |

Filters support student, lifecycle statuses, half-open date range, topic query, series, archived inclusion and presentation context. `selectionMode: "matching"` freezes exactly the matching IDs minus exclusions; later matches never enter the job. `selectedIds` persist selection across pages. Cancellation's `useCredit` is the existing return/retain choice, not a new policy.

Types/schemas live in `src/domain/lessonBulk.ts`; stable-key client helpers are in `src/data/lessonBulk.ts`. PR 1.5 must retain keys across transport retries and use a new preview/key for changed selection or operation. A review token is not sufficient without its authenticated actor/studio authorization.

## Durable execution and result meaning

Items are claimed with lease tokens and processed in **separate RPC transactions**. Mutation, snapshot where applicable, audit, occurrence notification intent and financial recovery intent commit together. Failed audit or mutation rolls back the record change. Successful items never become pending through retry. A lost response is transport-pending; the worker reclaims an expired lease and observes the committed item result rather than inventing a second operation.

Five automatic attempts use backoff; an exhausted expired claim becomes an explicit failed item. Manual retry queues failed items only and remains idempotent. Every attempt rechecks the original fingerprint. Changed versions, new dependencies or changed consequences become `conflicted` and require a new review; retry cannot bless them. Background maintenance advances bounded chunks and isolates item transport failures. Its bulk-claim failure does not abort credit maintenance.

Progress separates `succeeded`, `skipped` (including blocked review items), `conflicted`, `failed`, `pending`, and `synchronizationPending`. Calendar projection and notification intent/outbox completion are observable independently of the mutation. No email is queued by archive, restore, void or dependency-free deletion. Actual cancellation uses the existing protected notification system.

Coverage allocation is deferred to PR #37's durable recovery queue while selected cancellations run; financial reservation history is never redistributed to make an outdated review pass. A concurrent maintenance or financial change can legitimately conflict remaining items. Re-review is required for those items.

## Validation record

Initial local evidence, October 14, 2026: **719 unit/integration tests across 112 files passed**, including **97 database tests**. Typecheck, quiet lint, formatting and secret checks passed. The 5,000-record fixture completes a full persisted review and checks page boundaries; 5,001 is rejected. Prior PR #36–38 regressions remain in the suite.

New full-schema pgTAP covers physical removal and scaffolding, retained immutable snapshot/audit, replay, role restrictions, hidden JSON/array references, stale dependencies, expiry and archive/restore/void. Real separate-session PostgreSQL tests observe lock contention for late foreign-key references, JSON writers, tombstones after deletion, duplicate item processing and concurrent lesson updates. The authenticated browser harness exercises exact deletion, history, replay, archive/restore and portal denial on the ephemeral stack only. Final-head run IDs and passed/failed/blocked results are reported on the draft PR; pending checks are not assumed passed.

Windows has no running local PostgreSQL container, so complete migration replay/lint, pgTAP, generated-type comparison, real concurrency and authenticated browser evidence come from isolated CI. The existing provider-dependent Stripe check remains blocked without isolated credentials; no live Google/email/Stripe behavior is claimed verified. PR #38's unavoidable in-flight external synchronization window remains.

## Changed-file inventory

| Area                                  | Files                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema and database verification      | `supabase/migrations/20261014203257_bulk_lesson_management.sql`, `supabase/tests/lesson_bulk_management.sql`, `scripts/test-lesson-bulk-concurrency.mjs`, `src/types/database.generated.ts`                                                       |
| Backend commands, recovery and errors | `netlify/functions/_v2/lesson-bulk.ts`, `netlify/functions/_v2/lessons.ts`, `netlify/functions/_shared/lesson-bulk.ts`, `netlify/functions/_shared/schemas.ts`, `netlify/functions/_shared/http.ts`, `netlify/functions/booking-maintenance.ts`   |
| Contracts and list compatibility      | `src/domain/lessonBulk.ts`, `src/data/lessonBulk.ts`, `src/data/repository.ts`, `tsconfig.node.json`                                                                                                                                              |
| Regression and fixture harness        | `netlify/functions/_shared/credit-invoice-database.test.ts`, `netlify/functions/_shared/lesson-bulk.test.ts`, `netlify/functions/_shared/package-renewal-pricing.test.ts`, `netlify/functions/e2e-fixtures.ts`, `e2e/lesson-bulk-backend.spec.ts` |
| Isolated CI and delivery              | `.github/workflows/ci.yml`, `.github/workflows/deployed-browser.yml`, `package.json`, `docs/bulk-lesson-management.md`                                                                                                                            |

## Review and release risks

Deletion's non-FK fencing intentionally trades short-lived write contention for safety; review large-fixture latency and concurrent write behavior in staging before production approval. Interactive preview is bounded to 5,000 records, but reference scans depend on the size of associated tables. Maintenance uses the existing five-minute cadence; large accepted jobs can require many invocations. No user-facing time estimate is promised.

Retention cleanup for operational jobs is not added: approved record snapshots and audit must remain. The narrow existing non-production fixture endpoint can remove only synthetic jobs whose entire reviewed topic set has the exact fixture-run prefix, and it verifies baseline restoration in CI.

PR 1.5 must provide unified selection across student/studio/calendar list surfaces, all-matching confirmation, review pagination, explicit reasons and scopes, accessible progress/conflict/retry results, archive/void history and clear permanent-deletion wording. PR 1.6 follows with student Overview, Household, Payments and credit controls. The full six-wave plan remains required. No production release is authorized by this draft.
