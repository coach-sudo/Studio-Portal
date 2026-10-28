# Reschedule overlap reporting

Before implementation: SP-09 and remaining SP-03 conflict-time display; B03/B05/B06/B08, X02/X06/X13. Scope the shared reschedule form, Calendar move/resize/create proposal and coach-only conflict-read endpoint. Depends on the historical-correction interface #78 and its #77/#73/#71 stack. No structural overlap exception is proposed or implemented.

The database exclusion predicate applies to scheduled lessons whose offering is null. Preserve it and its concurrent-write protection. The server must authorize the selected target lesson and classify private scheduled overlaps separately from draft/group advisory overlaps and Google busy time. Missing/old classification cannot offer an override. Only an explicit Google conflict review sets the existing `allowConflict` flag; advisory acknowledgement cannot bypass a local private exclusion.

Display conflict intervals in the selected studio timezone, including date boundaries. Preserve input on provider errors; disable time edits while their conflict request is pending. Share local/demo classification rather than duplicating three reschedule filters. Existing recurrence/occurrence/financial reviews remain authoritative; conflict preview is not a reservation or proof a transaction will commit.

Retain a baseline reproduction of the generic local override before changing it. Verify authorized endpoint classification and failures, shared form outcomes/keyboard/retry, all applicable lesson/group/draft combinations and current PostgreSQL overlap/concurrency gates. Browser evidence must cover four widths/two engines. Rollback restores application reporting only; no migration, balance change, constraint removal or hosted action is required. Canonical historical reconciliation remains independent work.
