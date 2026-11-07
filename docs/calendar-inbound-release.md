# Inbound Calendar reliability

The incremental worker uses the existing provider intake schedule and requires `GOOGLE_CALENDAR_INBOUND_ENABLED=true` in addition to the existing provider intake gate. `GOOGLE_CALENDAR_ID` selects the Google calendar. The worker resolves `primary` to a stable Google calendar ID. A deployment with multiple studios must specify `GOOGLE_CALENDAR_STUDIO_ID` before running incremental Calendar intake.

Isolated staging can set the functions-only secret `GOOGLE_GMAIL_INTAKE_REFRESH_TOKEN` for a separate Gmail read-only grant issued to the same OAuth client. Calendar and the other Google integrations continue to use the existing credential. If the intake-specific grant is absent, Gmail intake uses the existing shared grant.

The private `calendar_inbound` schema stores one cursor and one page checkpoint per studio and calendar. It commits each page and its reconciliation in the same database transaction. An overlapping worker can read the same Google page, but only the worker holding the current checkpoint revision can commit it. The final page replaces the sync token. An expired token starts a new scan while retaining lesson history and previous observations. A previously mapped event absent from a completed replacement scan goes to review.

The first observation of an existing projection requires the exact Google event ID and acknowledged provider revision. Later observations retain the calendar-qualified link. The worker records recurring parent and original occurrence start, including on cancellation tombstones. Unlinked transparent events are personal and opaque events are busy-only. Existing verified imports and ambiguous portal identities go to review without changing their records.

Only a future, mapped lesson with an acknowledged portal version can receive a timing change or cancellation automatically. The existing lesson command applies the change, preserves its audit history, and suppresses outbound projection. Overlap, a concurrent portal edit, a historical change, and a declined canonical command require review. While incremental intake is active, the outbound worker also checks the saved Google revision before writing so a stale portal update cannot overwrite a newer Google edit. The existing outbound conflict hold then prevents repeated claims.

PR #79 supplied the bounded page and identity patterns. PRs #83 and #84 supplied source protection and timestamp normalization patterns. PRs #80, #86 and #89 contain separate UI and historical review work. This release retains those boundaries and uses the deployed lesson command for mapped changes.

Before enabling production intake, complete the existing Calendar and Gmail safety checks, confirm the configured studio and calendar, and obtain separate authorization. Assess first-scan review volume before enabling automatic processing on the production calendar. Use dedicated fixtures and the protected deployment workflow for acceptance.
