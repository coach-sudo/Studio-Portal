# Credit lifecycle reliability — modernization PR 1.2

This is a dependent change on draft [PR #36](https://github.com/coach-sudo/Studio-Portal/pull/36), pinned at `f99f8cc0b7ae209e27562014e0743f39052f1dad`. Its PR base is `codex/credit-coverage-diagnostics`, not `main`. The October 14 read-only production migration check still ends at `20261008220659_bounded_legacy_material_snapshots`; neither modernization migration is assumed to be deployed.

## Results and transactions

All account application results distinguish `applied`, `alreadyCovered`, `skipped`, and `failed`. Applied counts come from newly inserted negative ledger rows while holding the student lock. Existing holds are counted only as already covered; inconsistent holds are skipped for review. `skipReasons` uses the PR 1.1 evaluator's reason codes, and failures contain SQLSTATE counts rather than database messages or private content. Zod validates worker counts against their reason totals.

Coach credit grants, package assignment, automatic preferences, and total adjustments commit their mutation, audit, recovery intent, and replay response together. Exact replays return the original result with `duplicate: true`; those historical applied counts describe that original operation. Changed replay requests are rejected. Ordinary repeat scans report zero new application. The grant boundary also recognizes pre-upgrade provider ledger keys and does not issue another grant.

Manual per-lesson application remains available through its existing explicit command. Apply upcoming requires a reviewed enabled account and never saves or enables the preference. Disabling automatic use preserves existing holds. Mixed legacy preferences now require coach review before any new automatic application; preview and eligible manual operations remain separate.

Financial policy is unchanged: one credit per eligible participation, earliest expiration first, chronological upcoming allocation, expiry strictly after lesson start, no redistribution of valid holds, no completion double debit, existing cash/partial/waiver/refund/checkout protection, reserved floor, append-only adjustments, and the existing 30-day transfer treatment for returned expired credit.

Coach and self-service booking reschedules both check reservation expiry and invoice checkout protection before changing times, then evaluate new coverage. The self-service command retains its booking-only response; token possession does not reveal account summaries. Repeated manual application finds existing coverage even with zero available credits and reports no new debit, while automatic use stays unchanged.

## Event-path disposition

| Boundary                          | Reliability change                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Enable / adjust / apply           | Accurate transactional counts, version checks, audit and replay receipt; recovery intent                                           |
| Legacy coach grant                | One SQL transaction; immediate coverage and durable retry                                                                          |
| Coach package assignment          | Package, ledger, audit, coverage and replay receipt together; reviewed quote preserved                                             |
| Invoice package fulfillment       | Existing exactly-once issued-line fulfillment retained; accurate coverage returned and retry recorded                              |
| Stripe purchase                   | Existing receipt/payment/grant transaction now includes coverage intent; removed redundant handler scan                            |
| Paid renewal                      | Uses purchased quantity and existing ledger key in the atomic grant RPC; checked grant errors before updating agreement            |
| Gift delivery                     | Existing paid-price snapshot and claim replay retained; account coverage evaluated in claim transaction                            |
| Create / recurring conversion     | After all occurrences exist, evaluate affected accounts immediately; return original new counts rather than a second scan's counts |
| Ongoing generation                | Confirmed, active bookings only; generated occurrences receive an account check                                                    |
| Public booking                    | Existing mandatory credit rollback retained; optional application checked; new counts returned with recovery intent                |
| Reschedule / cancellation         | Recheck affected students after final times, participation, settlement and returned credits; preserve valid holds                  |
| Completion                        | Existing idempotent response and single debit retained; refresh coverage                                                           |
| Provider import / identity review | Evaluate after participation/identity writes; paid lessons remain protected, uncertain external payment policy requires review     |
| Invoice void                      | Recheck newly eligible obligations after checkout protections and void commit                                                      |
| Maintenance                       | Bounded durable sweep and jobs; independent per-account results and retries                                                        |

## Recovery

`credit_internal.credit_coverage_jobs` records requested/completed account versions, generations, attempts, backoff, safe error state, and last result. Generation changes also capture lesson events that do not change an account version. Explicit financial/event boundaries enqueue intent; no reservation trigger recursively schedules work.

Immediate coverage failures roll back the failed reservation and its related invoice writes, while a successful grant and its recovery intent survive. Workers request at most 25 accounts per invocation and process each in a separate RPC transaction. A durable UUID cursor advances the enabled-account sweep across invocations. Pending failed jobs retain backoff; explicit new events can wake them. Repeated or overlapping workers serialize on the student lock and skip completed jobs. Transport errors are reported separately and attempt to persist backoff.

The queue and replay receipts are private, RLS enabled, and inaccessible to portal clients or direct service table reads. Authorized PR 1.1 diagnostics expose only maintenance status and versions. The existing protected E2E endpoint has a narrow service-only cleanup RPC: only named `e2e-` fixtures with no remaining financial, package, lesson, or participation records qualify.

## Verification and limits

PGlite executes actual migrations and lifecycle commands. New cases cover grant/assignment replay, changed requests, transactional audit failure, coverage-write failure and recovery, enable/disable/adjustment, recurring conversion, cancellation reuse, reschedule eligibility/expiry, completion replay, imported payment review, provider purchase replay, and gift paid-price preservation. Handler tests cover reviewed pricing and the new atomic boundaries. `supabase/tests/credit_lifecycle.sql` exercises the complete schema, roles, results and recovery; the prior characterization tests now assert the repaired behavior.

`scripts/test-credit-concurrency.mjs` uses two real PostgreSQL sessions in the isolated local Supabase Docker database, observes lock contention, verifies exactly-once grant/audit, and repeats concurrent scans. It has no remote or linked database target. Migration CI runs it after full replay, SQL lint and pgTAP. CLI type comparison remains a required gate.

Local Windows has no running PostgreSQL/container stack. Full PostgreSQL, pgTAP, concurrent-session and authenticated browser evidence therefore comes from isolated GitHub CI. Live provider payment/calendar/mail verification remains unavailable without isolated credentials. No production migration, reconciliation, payment, message, merge or publication is authorized.

Shared-booking occurrence cancellation/reminder safety remains **PR 1.3**. This PR does not authorize those existing booking-wide effects for bulk use. Imports with uncertain payment policy stay review exceptions; this work does not invent an external payment allocation or a new policy editor. Import identity/participant writes still use their existing multi-call boundary; the periodic enabled-account sweep recovers interrupted coverage calls, but this is not a transactional import rewrite.

Roll back application behavior by reverting this PR; keep additive schema, ledger and audit history. Deploy both migrations in dependency order only after an explicitly authorized release.

### Local evidence, October 14, 2026

- Initial full Vitest: **651 tests / 109 files passed**. Follow-up manual replay and self-service reschedule regressions bring the lifecycle database suite to **46 tests**, rerun with the four affected handler tests: **50 passed**.
- Typecheck, production build, quiet lint, formatting, secret scan and whitespace checks passed.
- Existing hard bundle budgets passed: maximum JS 111,672 gzip bytes; CSS 23,090 gzip bytes. The existing 22 KB CSS warning remains.
- Full PostgreSQL replay/lint, pgTAP, concurrency, regenerated-type comparison and the isolated authenticated browser suite are pending draft-PR CI at initial delivery. No production or provider test was substituted for the missing local container runtime.
- Follow-up isolated CI at `7857031`: full PostgreSQL replay and public/private SQL lint passed; **111 pgTAP checks / five files passed**; two PostgreSQL sessions passed concurrent grant/replay and repeated scans with observed lock contention. The CLI-generated type artifact from this stack replaced the initial declarations. Final-head checks are reported on the draft PR.
