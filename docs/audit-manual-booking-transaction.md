# Manual booking command remediation

Independent from main `fb2fcb63f7ac6f06dc8ee9d954e519bdde5773cb`; findings SP-05/06/07/08/09. Affects B03, D01/D06, E05/F05 and X01/02/05/09/13/14/20. Historical time UI and outcomes follow separately. Existing public/student policies and private-overlap exclusion remain unchanged.

## Command and recovery contract (before implementation)

One coach-authorized PostgreSQL transaction owns booking, occurrence, participant, ledger, credit-coverage evaluation, audit, Calendar projection, notification intent and immutable replay response. Actor/key serialization and a SHA-256 request hash return the same logical result for an identical retry; changed-payload reuse is rejected. Replay is checked before provider work and again inside the transaction. Payment recording must succeed before paid state is assigned. No compensating delete remains.

Notification production is a durable private intent, claimed/fenced by the existing maintenance path when automation is enabled. Queue failure leaves committed business records intact and retries the same deduplicated booking notification. Calendar projection remains independent. Unknown external delivery is never described as delivered. Historical requests do not queue notices. Existing historical rows and financial constraints are retained.

Canonical scheduling does not require an unconfigured Google account. A configured but unavailable account blocks with an actionable error unless the coach explicitly chooses an audited Google-only override. Local scheduled-private overlap remains prohibited by the existing exclusion constraint, including concurrent requests. UI must distinguish these cases; no structural overlap policy change is implemented. An approved-overlap model, its financial/calendar implications and constraint design require a separate product decision.

Release gates: exact-head full migration/SQL lint/type parity/pgTAP, payment/audit/intent fault injection, identical and changed replay, lost response, concurrent same/different keys, provider outage, coach/student/guardian/anonymous enforcement, browser input preservation, outbox failure/retry and controlled provider acceptance. Local mocks alone cannot resolve the financial findings.

Rollback: revert application use; keep additive private receipt/intent tables and committed bookings. Drain or preserve pending intents deliberately under existing worker stops. Never delete a committed booking, ledger, historical migration or receipt as rollback. No hosted migration or publication is authorized.

## Executed checkpoint

At `0f035e57fb2b72229b30525a692dc821240804f5`, isolated [migration CI](https://github.com/coach-sudo/Studio-Portal/actions/runs/40634201357) passed upgrade/clean replay, SQL lint, pgTAP including payment/audit/intent rollback and role denial, plus all existing concurrency scripts and the new manual-booking same-key/different-key overlap races. The gate then correctly failed generated-type ordering. Verify CI correctly rejected one test-file formatting difference. Those are corrected without changing financial behavior; final-head revalidation is required.

Local command/effect/form checks passed 12/12, and existing booking-flow/maintenance tests passed in separate focused runs. Canonical commit remains distinct from notification production and external delivery. Production remains unchanged.
