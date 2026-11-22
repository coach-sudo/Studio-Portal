# Reviewed credit adjustments

## Existing accounting

Student packages hold entitlement lots, and signed package credit entries record grants, holds, use, and returns. The student credit summary derives the balance from entries and reservations. Payment entries and invoices track financial amounts separately. Credit coverage evaluates upcoming lessons and the existing worker retries allocation if the synchronous coverage check fails.

The coach's live adjustment previously accepted a single remaining total. It could decrease that total, but the action did not name removal, and the database chose the lots to debit. The action is blocked when legacy reservation evidence needs review or when the target falls below the reserved quantity. The cause and correct balance for the reported student have not been established.

## Coach workflow

Open the student's credit account and select **Manage credits**. Choose **Add Credits**, **Remove Credits**, or **Set Correct Balance**. Enter the amount and a reason, review the projected balance, then confirm. The preview shows unused, reserved, and available credits before any automatic reservations. Review upcoming coverage if the proposed change reaches reserved credits. Use **Legacy reconciliation** to review older series reservations when their lesson associations are known.

The adjustment is still at the student-account level. Review package and lesson history before correcting a mixed account. If the ledger is disputed or the source is unclear, review the history before making a change.

## Migration and compatibility

The additive function update leaves existing data and grants in place. The command compares the reviewed balance while holding the existing student lock and records the before and after balances. It still accepts requests from the previous application. The new application requires the migration for the additional server-side snapshot check. To roll back the application, retain the database function and the audit history. Any database rollback should restore the function body in a separately reviewed forward migration.

Package-specific corrections, restorations, household sharing, bulk operations, and credit reminders remain outside this change. No production migration or reminder activation is included.

## Remaining review stages

The original 32 approved decisions remain the acceptance criteria for the overall overhaul. This draft covers the initial coach adjustment workflow.

### Stage B — Credit accounting and reconciliation

Add package-scoped corrections, linked reversal and restoration, and guided reconciliation of legacy balances and reservations. Preserve completed lesson history, original financial entries, and immutable audit evidence. Derive unused, reserved, and available balances from the existing ledger by compatible service and duration. Test issuance, booking, completion, cancellation policy, reschedule, expiry, and concurrent adjustments as one accounting boundary.

### Stage C — Household and advanced administration

Build on the Stage B accounting boundary. Add explicit individual and shared household ownership and member eligibility, atomic bulk previews and adjustments, authorized transfers, paginated history, and student and guardian visibility. Connect the shared Manage Credits interface to Credit Attention and lesson context. Verify household isolation and simultaneous reservation against shared capacity.

### Stage D — Automated reminders

Build on verified coverage and household recipient authorization. Add configurable low-credit thresholds and upcoming shortage detection, shared condition state for email and portal, designated billing contacts and optional student copies, and editable templates with previews. Revalidate each three-day follow-up, suppress disputed balances, and deduplicate delivery across retries. Gate production activation on separate authorized publication, verified hosted authorization, approved templates, recipient mapping, and delivery tests. Preserve existing intake and outgoing mail restrictions.

## Review baseline and integration

The original implementation commit is a58c07e3ad0bfa1966c656c5ba803c7d0ad21f37, based on protected main at 853cb275c2d2e56f2088adea5b48524ee955115d. The branch adds a single function migration with the same RPC signature and grants. Adjustments use the entitlement ledger. The diff changes no Stripe, refund, invoice, or payment write paths.

PR #93 changes Calendar intake and lesson conflict handling without touching this branch's files. Its scheduling paths still warrant combined coverage tests if it lands before Stage B. PR #42 overlaps the credit UI and accounting test fixture and is on an older stacked base. Compare behavior before integrating it. The open manual booking and installment settlement work intersects future Stage B reservation and fulfillment paths.

This draft uses the repository's no-deploy convention. Hosted verification requires an approved exact-head protected staging deployment, acceptance manifest, and exact-host perimeter and role sessions. Isolated CI and local fixture evidence do not clear that gate.

## Local browser evidence

The focused coach adjustment and existing coach financial navigation and axe scenarios passed at 1440 px, 768 px, and 390 px. The adjustment scenario checks removal protection, required reasons, preview without mutation, edit navigation, and keyboard focus return.

- [Desktop](credit-overhaul-evidence/desktop.png)
- [Tablet](credit-overhaul-evidence/tablet.png)
- [Mobile](credit-overhaul-evidence/mobile.png)

The broader filtered run passed six checks and failed 18. All six failing student and guardian scenarios were reproduced on protected main at desktop width. The fixture routes showed **Record unavailable** before reaching the credit controls. The full Vitest run passed 1,197 tests.
