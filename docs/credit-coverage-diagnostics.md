# Credit coverage diagnostics — modernization PR 1

This change begins the approved [master plan](studio-portal-modernization-master-plan.md). It adds authoritative read-only credit diagnostics and factors reservation eligibility into one private SQL evaluator. It does not activate a new UI, change automatic preferences, reconcile balances, or implement the later lifecycle and bulk-operation PRs.

## Contract and authorization

`student_credit_coverage(p_student, p_page = 1, p_page_size = 25, p_preview_enable = false)` returns a current account summary, bounded upcoming lesson rows, and counts for the complete upcoming set. Page sizes outside 1–100 are rejected. Allocation is chronological across the whole upcoming set **before** selecting a page. Earliest-expiring eligible lots are used first, and a preview never writes reservations or settings. Returned summaries omit unbounded lot histories.

Each row distinguishes `covered`, `eligible_unreserved`, `ineligible`, and `review_required`. Reason codes explain existing reservations, insufficient credits, expiry, cash/partial payment, invoice or booking processing, disabled automatic use, mixed preferences, and reconciliation requirements. A financial conflict or invalid existing reservation is shown for review without modifying its ledger.

The public function is an invoker. It delegates to a private, explicitly guarded read facade because finance-only guardians cannot SELECT lessons/bookings under schedule RLS; using those hidden rows as empty financial evidence would undercount reservations or miss cash-payment blockers. The facade checks finance permission, active record, portal access, and minor restrictions before reading authoritative financial data. It returns no lesson logistics or scheduling counts when schedule access is absent. The raw evaluator is executable only by the service role and trusted database functions, and `credit_internal` is not an exposed API schema. Unrelated identities and anonymous callers receive no coverage.

The existing reservation function calls the evaluator under its established student → lesson → package lock order. It rechecks after acquiring the lot lock. Existing reservations are returned unchanged, including flagged historical records; no reconciliation or new debit occurs on replay. Existing privileged-command grants remain unchanged.

`loadCreditCoverage` validates inputs and responses, supports request cancellation, and rejects mismatched student/view responses or inconsistent totals. It performs no frontend eligibility simulation.

## Preserved behavior and known gaps

PR 1 retains the current automatic eligibility policy, including the fallback from a null account preference to per-package flags. The response also exposes `settingReasonCode = mixed_settings_review`; a future UI must not present that as an unambiguously enabled account. Enable previews explicitly simulate all eligible lots without saving the preference.

The SQL characterization tests preserve two known gaps for PR 1.2:

- `reserve_student_upcoming_credits` counts an existing reservation as `applied` even though no new credit was reserved. Diagnostics report existing coverage separately. No count correction is smuggled into this foundation PR.
- `command_make_lesson_recurring` creates occurrences without immediately reserving available credits. Full-schema pgTAP exercises the actual existing command and verifies this gap.

## Credit event-path matrix

| Event                       | Current boundary                            | Next reliability work                                    |
| --------------------------- | ------------------------------------------- | -------------------------------------------------------- |
| Enable automatic use        | `set_student_credit_auto`                   | Transactional newly-covered/skipped results              |
| Adjust remaining total      | `set_student_credit_total`                  | Retain reserved floor and append-only history            |
| Legacy credit grant         | Finance handler inserts ledger row          | Atomic grant and immediate scan/retry intent             |
| Coach package assignment    | Separate package/ledger inserts, then scan  | Atomic replay-safe assignment and accurate counts        |
| Invoice package fulfillment | Invoice settlement commands                 | Retain issued snapshots and exactly-once grant           |
| Purchase / renewal          | Stripe webhook fulfillment                  | Atomic recovery intent and isolated retries              |
| Gift claim                  | Gift claim command and handler              | Consistent post-claim result/recovery                    |
| Lesson or series creation   | `command_create_lesson`                     | Verify every occurrence and account summary              |
| Recurring conversion        | `command_make_lesson_recurring`             | Add immediate scan after all occurrences exist           |
| Public booking              | `confirm_booking`                           | Retain credits-required rollback and cash protections    |
| Reschedule                  | `command_change_lesson_state`               | Recheck uncovered lessons, preserve valid holds          |
| Provider import/review      | Provider intake and administrative commands | Scan after verified identity/payment participation       |
| Cancellation                | Cancellation/settlement commands            | Recheck after eligible credits return                    |
| Completion                  | `command_complete_lesson`                   | Preserve exactly one debit and refresh summaries         |
| Maintenance                 | `applyAutomaticCredits`                     | Bounded durable jobs, accurate counts, isolated failures |

## Validation and release

- PGlite executes the existing credit/invoice migration and this new migration together. Tests include reservation/completion/cancellation invariants, pagination allocation, expiry, paid/partial/pending lessons, group membership, mixed flags, malformed paging, unauthorized reads, and unchanged records after previews.
- `supabase/tests/credit_coverage.sql` runs against the complete Supabase migration chain in the existing migration CI job. It tests real grants/RLS, finance-only and work-only guardians, revoked access, adult/minor identities, immutable previews, and recurring conversion.
- Local PostgreSQL/pgTAP execution is unavailable without a working container runtime. PGlite is additional evidence, not a replacement for the migration CI gate or concurrent-session tests.
- New generated public RPC typing is checked against CLI-generated types by migration CI. Private helpers remain outside public generated types.
- A main-targeting PR explicitly marked `[skip netlify]` skips only the unavailable external preview smoke job; the existing full isolated browser suite still runs. Normal preview smoke gates are unchanged.
- No production migration, deploy, live payment, outbound email, or financial reconciliation is authorized. Keep this as a draft review until migration/type checks pass.

The migration is additive apart from the reservation function refactor. Application rollback leaves the unused read API in place; revert the reservation function body through a separately reviewed migration if necessary. Never reverse ledger history as rollback.

### Local verification, October 14, 2026

- Full Vitest run: **635 tests / 109 files passed**. The final cross-studio participation guard was then added and the two affected suites were rerun: **40 tests passed**.
- Typecheck and production build passed. Bundle hard budgets passed: largest JS 111,672 gzip bytes; global CSS 23,090 gzip bytes. The existing 22 KB CSS warning remains.
- Lint passed with zero errors; the repository warning baseline remains. The changed TypeScript/test files also passed a separate quiet lint check.
- Formatting, secret scan, and diff whitespace checks passed.
- PostgreSQL migration replay, SQL lint, pgTAP, and CLI-generated type comparison require the isolated CI gate. There is no local Podman machine or PostgreSQL installation. Authenticated/provider browser journeys were not run for this backend-only foundation; no visual changes were made.
