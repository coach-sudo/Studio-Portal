# Stage B package accounting and reconciliation

This draft is stacked on [Stage A PR #94](https://github.com/coach-sudo/Studio-Portal/pull/94), based on Stage A commit 2e47930e45811308525d40461403d5359ffff828. It uses the existing credit command, coach authorization, package ledger, and unique reversal link. The Stage A quick adjust remains available for simple balances. Reviewed aggregate changes are redirected to package selection when multiple active lots would make the target ambiguous.

## Coach workflow

Open **Packages and reconciliation** in the student's credit account and choose a package. The panel shows the package's current recorded terms, issued, consumed, unused, reserved, and available quantities, purchase references, and paginated entries. Reconciliation findings identify unexplained or incompatible debits for review. Expand reservations to find the lessons preventing a reduction. Use a package action or a source entry's **Reverse entry** or **Restore consumed credit**, then provide a reason and review the before-and-after balance.

A scheduled net debit is a hold. A completed lesson with a net debit has used the entitlement. The existing ledger deducts the hold once, and completion retains the same debit. A linked restoration releases that debit while keeping the lesson completed and the original entry in history. Credit corrections leave financial records untouched. Package selection, review state, reason, replay identity, and the reserved floor are verified under database locks.

## Reconciliation and scope

The review reports negative balances, missing issuance, orphaned and canceled lesson debits, duplicate net debits, overlapping package allocations, and incompatible or expired holds. Existing provider idempotency keys still prevent exact replays. Historical grants with unrelated source keys require administrative evidence before they can be identified as duplicates. The reported student's identity and intended balance were outside this development review.

The migration checks exact service and duration for defined packages in the coverage evaluator, and protects typed holds at reschedule and completion. The draft flags definitionless legacy lots in the package review. Those lots still take the legacy allocation path, and the currently linked definition remains the source of typed terms. Verified legacy eligibility, immutable purchase-time terms, comprehensive mismatch resolution, and replacing aggregate displays throughout the portal remain necessary for Stage B acceptance. Historical balances are never rewritten by the migration.

## Responsive evidence

The package review includes the package totals, expanded history, reconciliation findings, and reservation details. Each capture uses synthetic data and a locally intercepted API.

| Width   | Package, history, and findings                               | Reversal                                                       | Restoration                                                    | Reservation conflict                                                 |
| ------- | ------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Desktop | [Review](credit-stage-b-evidence/desktop/package-review.png) | [Reverse](credit-stage-b-evidence/desktop/reverse-preview.png) | [Restore](credit-stage-b-evidence/desktop/restore-preview.png) | [Conflict](credit-stage-b-evidence/desktop/reservation-conflict.png) |
| Tablet  | [Review](credit-stage-b-evidence/tablet/package-review.png)  | [Reverse](credit-stage-b-evidence/tablet/reverse-preview.png)  | [Restore](credit-stage-b-evidence/tablet/restore-preview.png)  | [Conflict](credit-stage-b-evidence/tablet/reservation-conflict.png)  |
| Mobile  | [Review](credit-stage-b-evidence/mobile/package-review.png)  | [Reverse](credit-stage-b-evidence/mobile/reverse-preview.png)  | [Restore](credit-stage-b-evidence/mobile/restore-preview.png)  | [Conflict](credit-stage-b-evidence/mobile/reservation-conflict.png)  |

## Release boundary

The additive migration changes a coach-only RPC and the internal lesson coverage rules. It creates an internal trigger that rejects incompatible or expired typed holds when a lesson is rescheduled or completed. The safe rollback is a reviewed forward migration restoring the prior function bodies and dropping the new trigger. Preserve any compensating entries already committed.

Use the project's unpublished PR workflow. Protected hosted evidence requires separate approval for an exact-head protected staging target and role sessions. Local fixture and isolated CI results do not satisfy that gate. Household pools and bulk administration remain Stage C. Reminder state, templates, delivery, and activation remain Stage D.

## Verification

A disposable PostgreSQL 17 Supabase stack replayed the full migration chain. SQL lint passed at the error threshold. All 575 pgTAP assertions passed across 21 files, including 23 new package tests. The existing two-session credit concurrency test passed with observed lock contention. The focused coach package flow passed at all three screenshot widths. The broader candidate run includes the 18 inherited Stage A student and guardian checks so failures remain visible.
