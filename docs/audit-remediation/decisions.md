# Decisions and acceptance holds

These proposals are reviewable draft implementation policies. Approval does not authorize a merge, hosted migration, deployment, worker enablement, real email, charge, refund, import or backfill.

## SP-04: correct an existing lesson's date/time

The original server's `lesson_ops.assess_change` and shared reschedule UI both reject past targets and non-scheduled outcomes. Removing either guard alone would bypass occurrence, credit-expiry, checkout and provider policy. Draft #73 fixes historical creation and timezone input; drafts #77/#78 implement the separately approved correction path. The ordinary upcoming-reschedule policy remains distinct.

Proposed separate **Correct Lesson Date/Time** command: coach authorization in PostgreSQL, exact lesson/version, explicit timezone/instant, reason, stable command key/hash, before/after audit and replay receipt. Preserve original `created_at`, attendance outcome and all append-only ledger entries. Never reprice, charge, refund, consume/reverse credits, settle an invoice or send a notification implicitly.

Preview linked bookings/participants, invoice lines and checkout claims, consumed/reserved credits and expiration eligibility, recurring-series scope, Calendar/Meet identity, notes/work and existing correction history. Reject local private overlap under the existing constraint. A single correction changes only the selected occurrence; recurrence changes require their own reviewed operation.

Approved for draft implementation by the user on October 28: allow a correction with no financial/checkout dependencies immediately after its preview. Hold financially linked corrections until the coach explicitly acknowledges a financial review that preserves the original accounting; expose a durable **financial review required** state rather than inventing balancing entries. Historical corrections suppress provider/notification work by default and expose any Calendar discrepancy for separate review. Upcoming scheduling moves continue through **Reschedule Upcoming Lesson** and its existing provider/financial policy. Correcting a date never proves attendance. Moving a completed record to a future date must explicitly confirm that its recorded outcome is being preserved.

The alternative was to keep all financially linked historical corrections blocked until a separate accounting-correction workflow exists. The approved policy permits no automatic historical balance repair. Production/release approval remains separate.

Implementation evidence: #77's 40 real PostgreSQL assertions, full schema upgrade/replay/grants/fault suite and concurrent sessions passed. #78 adds the coach interface, missing/invalid timezone errors, explicit repeated-hour choices, financial acknowledgements, cursor history and review notes; 23 targeted cases and eight Windows Chromium/WebKit correction fixtures pass. No correction or review has been submitted to a hosted environment. Financial/provider holds are retained, and a review note does not resume automatic coverage or verify external delivery.

## SP-09: simultaneous private lessons

Draft #71 removes the promise that a Google conflict override can defeat the database's private-overlap constraint. Local conflicts remain blocking. A Google-only override is explicit and never presented as a successful Google availability check.

Recommended current policy: retain serialized local scheduling and the exclusion constraint. A structural private-overlap exception would need a documented authorized-coach reason, separate conflict domain/resource ownership, finance/attendance semantics for simultaneous lessons, Calendar/Meet handling and concurrent ordinary-versus-override tests. No structural exception or constraint removal is implemented or approved. Group teaching should use the existing group/offering model where applicable, rather than pretending it is a private override.

## SP-18: compromised-password protection

Read-only production Auth advisor still reports disabled leaked-password protection. [Supabase's documented control](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) is a hosted Auth setting; it was not changed. Private RLS tables without policies and guarded authenticated SECURITY DEFINER commands require contextual review; their presence alone does not establish an access-control defect.

Proposed enablement gate: first use a separately approved non-production Auth environment and synthetic coach/student/guardian/unrelated identities. Verify strong-password setup, rejection of a known compromised test password, retained input and actionable errors, initial temporary credentials, mandatory change, invitation replay/expiry, recovery replay/expiry, existing-session behavior and Google/magic-link paths. Validate server/database role boundaries directly; hiding controls is insufficient. No real invitations/recovery messages may be sent by this mission. Use a controlled capture mailbox and approved fixtures.

After those gates pass, request separate approval for the production setting and a narrow rollback runbook. Do not reset existing passwords, revoke sessions or alter account ownership as an incidental part of enablement. Current unit/ephemeral role tests do not verify the hosted breached-password service. Production configuration remains unchanged.

## Financial policy and provider holds

Draft #75 preserves normal positive installment settlement, with invoice identity and durable recovery. Zero-value installment invoices, late payments against cancelled/completed bookings and pre-cutover partial writes are held for reconciliation. These exceptional policies need review before release. Do not repair old counters or balances by replaying historical invoices. Unknown rounding delivery beyond the safe retry window requires external reconciliation; a new idempotency key is not a recovery strategy.

Calendar/Gmail controlled acceptance, three actual scheduled completions, Stripe sandbox faults, authenticated role/device checks, backup/restore evidence and an approved immutable staging deployment remain unexecuted release gates. No portal-wide certification is warranted.
