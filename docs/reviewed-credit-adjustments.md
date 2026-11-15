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
