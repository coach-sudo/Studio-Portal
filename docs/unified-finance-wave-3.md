# Unified Finance Wave 3 draft

## Baseline and reuse

Production served Git commit `34f8cf2415a28713af9dc6f650a6034108916f52` from locked Netlify deploy `6b01c8eac58a5046e4227dea`. The live health route agreed. Supabase recorded 89 migrations through `20261120192345_invoice_free_lesson_checkout.sql`. The live checkout, credit evaluator, invoice-save and explicit-credit functions matched the expected Wave 2 definitions and retained their private/service grants.

| Source | Reused in this draft | Kept out of this draft |
| --- | --- | --- |
| [#94](https://github.com/coach-sudo/Studio-Portal/pull/94) | Coach add, remove and set-balance preview, locked balance comparison, before/after audit and retry tests | Old migration filename and older browser fixture failures |
| [#95](https://github.com/coach-sudo/Studio-Portal/pull/95) | Lot terms for newly issued packages, reviewed package corrections, linked restorations, persistent cases and a verified same-intent fulfillment guard | Old evaluator and older booking/invoice assumptions. Historical package terms are preserved as unverified |
| [#96](https://github.com/coach-sudo/Studio-Portal/pull/96) | Explicit roster, package-row serialization, beneficiary attribution and shared balance per lot | Nullable replacement package ownership, separate household entities, bulk transfer and broad scheduling overrides. The draft's settlement and evaluator bodies predate Wave 2 cash holds |
| [#97](https://github.com/coach-sudo/Studio-Portal/pull/97) | Candidate input for future reminders is the guarded wallet, coverage reasons, and reconciliation state | All scheduler, delivery worker, template and outbox changes. The older reminder branch does not include current transactional invoice routing. Automated credit notifications remain off |

The earlier PRs remain drafts. Their provider, SQL and responsive test designs were reused where contracts still apply. Their exact-head check results do not transfer to this source.

## Implementation

- `20261122183610_wave3_reviewed_credit_adjustments.sql` checks the reviewed available, reserved and unused amounts under the existing student lock before a coach changes the ledger.
- `20261122183741_wave3_package_reconciliation.sql` records newly issued terms and records package-scoped decisions and compensating entries. Cases retain evidence, a version, a coach decision and an audit trail. Confirmed same-intent duplicate evidence is required to reverse a purchase grant. Money, invoice and refund history are preserved.
- `20261122183952_wave3_shared_coverage.sql` adds a private beneficiary roster and nullable attribution to new credit entries. The original package keeps one ledger and one owner. Both students must have the same current designated household payer. Named-student bookings reuse the existing lesson, student and package locks. An issued invoice or active cash claim blocks competing coverage. Multiple eligible shared lots go to review. Existing Wave 2 reservation and settlement safeguards remain in force. Fulfillment rejects two sessions representing the same verified payment intent.
- `20261122184344_wave3_package_projections.sql` extends the existing authorized coverage response with package totals and the requesting student's visible lesson usage. Payments shows each package once across the visible household. Raw historical entries retain their original data and require finance access to any newly attributed sibling.

## Design and evidence

The Finance prototype places package counts beside eligibility and lesson context, with exact before/after confirmation in the coach's Billing view. This draft uses those priorities, existing Finance layout primitives, and the existing Payments and Billing destinations. Reconciliation and history remain in disclosures. Screenshot fixtures exercise the actual route and query hooks with synthetic responses. Postgres tests exercise the actual authorization and ledger behavior separately.

| View | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| Coach adjustment | [1440 px](wave3-evidence/coach-desktop.png) | [768 px](wave3-evidence/coach-tablet.png) | [390 px](wave3-evidence/coach-mobile.png) |
| Adult student wallet | [1440 px](wave3-evidence/student-desktop.png) | [768 px](wave3-evidence/student-tablet.png) | [390 px](wave3-evidence/student-mobile.png) |
| Guardian shared wallet | [1440 px](wave3-evidence/guardian-desktop.png) | [768 px](wave3-evidence/guardian-tablet.png) | [390 px](wave3-evidence/guardian-mobile.png) |

Local verification covered 263 focused pgTAP assertions, including 32 reconciliation and 20 shared-coverage checks, plus six Wave 2 separate-session races and a two-session race for the last shared credit. Typecheck, 24 focused Vitest tests, and nine browser cases passed. SQL lint passed at the error threshold. Production data was not copied.

## Open limitations and release gates

- Current sharing requires a verified issued package and a common designated payer. Existing unverified lots remain visible for coach review. The draft does not infer or silently backfill historical terms, convert household ownership, or choose among equally eligible shared packages.
- Sharing applies to named-student lessons. Multi-participant shared entitlements, combining lots within a recurring purchase, and transferring the balance to a different owner remain review cases. Existing cancellation behavior is preserved for individual packages. An expired credit returned by a beneficiary does not become spendable or transfer to another lot without an explicit policy.
- Coach review records a decision about missing issuance, cash overlap, or uncertain historical evidence. Restoring consumed credits uses a linked compensating entry. Any decision requiring a change to verified cash settlement stays on the existing authorized financial correction path.
- **NO-GO for production.** Required CI and protected exact-head synthetic role acceptance are required. Because the purchase fulfillment boundary changed, protected acceptance must include a scoped Stripe sandbox fulfillment and replay check. Prior Wave 2 provider evidence remains valid for the unchanged checkout handler and settlement paths.
- Application rollback should leave recorded audits and consumed credits in place. Disable affected release paths as appropriate and use a separately reviewed forward database correction if necessary. Removing roster or trigger support while shared reservations are open is unsafe.
