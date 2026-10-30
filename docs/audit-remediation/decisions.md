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

## FIN-R02: duplicate student identity and financial history

**Approved for draft implementation by the user on October 28; no release action.** The real merge fails when an existing recovery job still references the removed student. Newer credit-account, invoice and receipt references also need ownership review, while several unrelated histories have cascading foreign keys. [The evidence and remaining risks](profile-merge-risk.md) distinguish the reproduced failure from schema-only risks. Deleting these dependencies or transferring their ownership automatically is not an acceptable repair.

Recommended design: preserve historical student IDs and link duplicate profiles through an explicit coach-reviewed identity group with a designated current profile. The coach can navigate the group's related records from that profile, while every lesson, ledger entry, invoice, command receipt and provider customer keeps its original identity. Display each financial account with its original owner and currency; do not sum incompatible/unknown balances, combine accounts, replay old receipts or grant credits. A later financial consolidation would require its own policy and approval.

Preserve existing student/guardian permissions per underlying record. Group membership alone must never grant a guardian or student access to another profile's private notes, schedule or finances. Different authenticated users, payer/guardian identities or Stripe customers remain an explicit review hold; no OAuth/customer/account transfer is inferred. Coaches retain normal studio authority. New scheduling must choose an explicit current student; old replay keys continue to address original records. Existing URLs and source/attendance/creation history remain valid.

The command must preview exact profiles and dependencies, require a coach reason, hash a stable request, recheck under locks and commit the identity link, audit and receipt atomically. No physical student deletion or provider/notification effect occurs. Reversing an identity grouping is a new audited action, preserving both original profiles and all receipts; it does not undo later financial or scheduling operations. Verify concurrent grouping, lost responses, stale previews, role boundaries, source links, package/invoice/checkout ownership and unchanged accounting before draft completion. Any necessary interaction changes need desktop/tablet/mobile examples before major restructuring.

Alternative: keep financially or historically linked profile merges blocked with explicit review guidance, while retaining separate profiles and making no identity model change. This preserves current records but leaves duplicate navigation unresolved. A physical merge with automatic financial consolidation is not proposed. The mission explicitly requires approval before consequential financial-policy changes, the user approved the identity-preserving design for draft implementation on October 28. Financial consolidation remains outside that approval. No grouping implementation, production mutation or release is implied.
