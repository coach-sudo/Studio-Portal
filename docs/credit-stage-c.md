# Stage C lesson coverage and renewals

This Stage C draft is stacked on [Stage B #95](https://github.com/coach-sudo/Studio-Portal/pull/95) at a2bb5a46806e3c311d8556317df5e4f22ecfe6b5. The Stage B verify and migrations jobs passed. Its isolated deployed-browser job stopped before producing a test report. Protected hosted acceptance remains open.

## Portal experience

Student Home shows the existing guarded coverage response in a compact Lesson Credits card. Credits & Lessons shows package-specific balances and the Stage B lesson coverage states. Upcoming lessons retain their scheduled status when a credit is missing. The view keeps credit counts separate from package prices and amounts due.

The guardian's Household Lesson Coverage section lists the student contexts authorized by the existing portal guard. Expand a student to see permitted package balances and upcoming coverage. The page performs no household arithmetic and adds no new ownership rules. Credit history uses plain-language entry labels.

A lesson needing credit links to contextual renewal. The new server check uses the selected student and lesson, existing coverage evaluator, exact service and duration, expiration, availability, and one-time billing configuration. The selected student must be an independent adult or the signed-in contact must be the active designated payer with finance access. Checkout rechecks the actor's authority, package eligibility, and quote. A return from Checkout shows processing until the coverage endpoint reports an actual reservation. The existing verified fulfillment path continues to issue credits and reevaluate allocation when studio settings allow it.

## Database and limitations

Migration 20261115160000_portal_lesson_renewals.sql adds an authenticated authorization and eligibility RPC. It updates no records. Roll back the application before removing the RPC through a reviewed forward migration.

Existing finance access continues to govern package counts. This draft does not expand finance access for minors or schedule-only guardians. These roles do not receive the new credit view without the required permission. No Stage D notification automation is included.

Only authorized exact-head staging can verify a real test-mode checkout and protected role access. That needs an immutable separately approved deployment, matching staging migrations, synthetic student and guardian credentials, and a test Stripe configuration. No hosted fixtures, reminders, or provider changes were made.

## Local screenshot evidence

Synthetic student and guardian fixtures show the home summary, both lesson coverage states, billing-contact guidance, and eligible renewal options at three widths.

| Width   | Student home                                             | Credits & Lessons                                               | Guardian household                                             | Renewal options                                               |
| ------- | -------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| Desktop | [Home](credit-stage-c-evidence/desktop/student-home.png) | [Coverage](credit-stage-c-evidence/desktop/student-renewal.png) | [Household](credit-stage-c-evidence/desktop/guardian-home.png) | [Renew](credit-stage-c-evidence/desktop/guardian-renewal.png) |
| Tablet  | [Home](credit-stage-c-evidence/tablet/student-home.png)  | [Coverage](credit-stage-c-evidence/tablet/student-renewal.png)  | [Household](credit-stage-c-evidence/tablet/guardian-home.png)  | [Renew](credit-stage-c-evidence/tablet/guardian-renewal.png)  |
| Mobile  | [Home](credit-stage-c-evidence/mobile/student-home.png)  | [Coverage](credit-stage-c-evidence/mobile/student-renewal.png)  | [Household](credit-stage-c-evidence/mobile/guardian-home.png)  | [Renew](credit-stage-c-evidence/mobile/guardian-renewal.png)  |

## Administrative follow-up

In the finance workspace, **Bulk credit adjustments** shows one reviewed package result per selection, including the current unused, reserved, and available amounts, proposed change, resulting unused balance, and conflicts with affected lesson names. The server locks all affected student records and package rows in a stable order, compares the approved preview, then invokes the existing package correction command in one transaction. A stale or conflicting preview leaves the entire batch unapplied. Exact retries return the earlier receipt. Individual and bulk package adjustments can be omitted from portal history while keeping the balance and coach audit complete. The legacy aggregate Stage A path is unchanged.

The additive migration 20261115170000_bulk_credit_adjustments_and_visibility.sql places visibility metadata in the private credit schema and limits raw ledger reads to studio coaches. Portal history and coverage use guarded projections. Roll back the application before restoring earlier command bodies. Retain the ledger, audit history, privacy policy and visibility records. Do not restore the former raw portal ledger visibility as part of a rollback.

Guardians can expand each authorized student's recent package purchases using the existing payment RLS and a scoped, limited read. The area displays financial amounts separately. Renewal reminder history is unavailable. No history or delivery workflow was fabricated.

[Protected staging acceptance](credit-stage-c-hosted-acceptance.md)

## Administrative and guardian screenshot evidence

| Width   | Bulk credit preview                                         | Guardian billing                                                  |
| ------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Desktop | [Preview](credit-stage-c-evidence/desktop/bulk-preview.png) | [Purchases](credit-stage-c-evidence/desktop/guardian-billing.png) |
| Tablet  | [Preview](credit-stage-c-evidence/tablet/bulk-preview.png)  | [Purchases](credit-stage-c-evidence/tablet/guardian-billing.png)  |
| Mobile  | [Preview](credit-stage-c-evidence/mobile/bulk-preview.png)  | [Purchases](credit-stage-c-evidence/mobile/guardian-billing.png)  |

## Verification

- Isolated migration replay completed. SQL lint reported no errors and warnings in existing function definitions. All 617 pgTAP assertions passed across 22 files.
- The existing 33 local candidate browser scenarios and three new bulk preview scenarios passed at desktop, tablet, and mobile sizes. The updated guardian coverage and purchase history scenario passed again at all three widths. The earlier 18 student and guardian fixture failures passed in the recorded local baseline.
- On the predecessor head 03d4b8cf1142f7538fbb9b6c1f7f10a1f2741aa5, GitHub verify and migrations passed. The isolated deployed browser workflow and its required smoke check failed. The browser report identified the absence of a test-mode Stripe key for scenario 08. That workflow cannot establish protected hosted acceptance.
- Build, bundle budgets, and secret scanning passed after the guardian update.

## Shared household accounting

Migration `20261115181801_shared_household_credits.sql` adds explicit credit households and a pool-specific eligibility list. Each existing package retains its student owner. A shared package has a household owner and no student owner. The original issuance, eligible services, duration, and expiration are retained in the existing terms snapshot. The migration adds no household records or balance entries to existing accounts.

In **Payments → Household credits**, a coach can create the household roster, set rules for future package issuance, issue a shared grant, preview member eligibility changes, and transfer credits. A member removal preview names any lesson that still holds a credit. Finishing that lesson or explicitly settling the reservation permits a fresh preview. Prior usage remains attributable to the original student. Package policies default to off. Changing a catalog rule does not make previously issued lots transferable.

The existing booking evaluator selects eligible individual and shared lots by earliest expiration, then favors a student-owned lot on a tie, then uses issuance time and ID. The transaction locks candidate lots in stable order and rechecks availability under the lock. Completion and chargeable cancellation append a linked settlement with the same owning pool and student. Timely cancellation releases the hold into that pool and preserves its expiration terms. The portal shows a lesson as covered only after the authoritative reservation exists. A compatible, unreserved credit suppresses contextual checkout and can be assigned through the established coverage workflow.

Transfers are restricted to verified terms that explicitly allow them and a recipient within the same explicit household. Each transfer creates a new destination lot that inherits the source entitlement and expiry. The two ledger entries and their audit record are written together. The coach can preview a transfer, including existing reservations and resulting availability. The command recomputes the preview under the lot lock, declines changed outcomes and reuses the original receipt on an exact retry. A shared destination starts with an empty eligibility list so the coach can explicitly approve each student. There is no financial mutation. Household issuance is a coach grant or authorized transfer. Existing student and designated-payer checkout remains the purchase path.

Guardians see each authorized pool once. Usage details and member names are limited to students whose finance access has been verified, and lesson details additionally require schedule access. Student and household views show shared quantities separately from individual package balances and renewal prices.

Roll back the client first if an application rollback is necessary. Retain the compatible schema, member records, ledger entries, receipts, attribution, and privacy controls. After any shared issuance or transfer, reverting the reservation SQL would strand active coverage. Use a reviewed forward repair backed by an isolated replay. Stage C production and protected hosted staging are unchanged.

### Shared-credit browser evidence

| Width   | Student                                                            | Guardian                                                             | Coach transfer                                                     |
| ------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Desktop | [Student](credit-stage-c-evidence/desktop/student-shared-pool.png) | [Guardian](credit-stage-c-evidence/desktop/guardian-shared-pool.png) | [Transfer](credit-stage-c-evidence/desktop/household-transfer.png) |
| Tablet  | [Student](credit-stage-c-evidence/tablet/student-shared-pool.png)  | [Guardian](credit-stage-c-evidence/tablet/guardian-shared-pool.png)  | [Transfer](credit-stage-c-evidence/tablet/household-transfer.png)  |
| Mobile  | [Student](credit-stage-c-evidence/mobile/student-shared-pool.png)  | [Guardian](credit-stage-c-evidence/mobile/guardian-shared-pool.png)  | [Transfer](credit-stage-c-evidence/mobile/household-transfer.png)  |

The isolated database run passed 672 pgTAP assertions across 23 files, including 55 new household assertions. The two-session concurrency script observed one winner for the last shared credit and a stale result for a competing transfer. All 36 local browser baseline cases and three new household administration cases passed.

Build, bundle budgets, the ESLint warning baseline, secret scanning, and generated types passed. The full local Vitest run passed 1,197 cases and timed out in the existing roster-navigation case. That case passed on its focused rerun. All 18 previously reported student and guardian fixture failures passed within the browser baseline.
