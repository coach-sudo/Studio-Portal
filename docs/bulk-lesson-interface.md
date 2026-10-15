# PR 1.5 — Unified bulk lesson interface

## Dependency and release boundary

Branch `codex/bulk-lesson-interface` starts at PR #39 (`codex/bulk-lesson-management`), exact head `8b8a0aa173bfbc03f0bdb01a3a8953459f86cd0f`. The dependency chain is #36 `f99f8cc0b7ae209e27562014e0743f39052f1dad` → #37 `0badcc648ec715e20c2be7849d0bdbd8ec0955e0` → #38 `c894f7f51f26aae0e9c396a4d791d2bbc0c1a545` → #39 → this draft. The dependencies remain open drafts, not assumed deployed. Main remains `6df35d700cc13d60ceab3e92293635575479ec4d`.

Source of truth: [master plan](studio-portal-modernization-master-plan.md), [bulk backend](bulk-lesson-management.md), [occurrence safety](occurrence-safe-lesson-changes.md). All commits and the PR title include `[skip netlify]`. Checks run on an isolated loopback Supabase/Netlify stack. No merge, deployment, production migration, live deletion, financial reconciliation or live notification is authorized.

## Coach workflow

Student Lessons and the studio Calendar's **list** view share the same bounded list and selection controller. Search title, lifecycle status and Include archived filters live in the URL, alongside page and size. Selection survives pagination and clears with an accessible announcement when its filter/student context changes. Select all matching uses a count and exclusions, without downloading IDs. Matching IDs freeze at review, and the confirmation shows the actual frozen count; a changed count is explicitly called out. Explicit selections and matching reviews are limited to 5,000 records.

After selection, one toolbar offers cancellation, archive, restore, void and permanent deletion. The coach supplies a reason and explicitly chooses selected occurrences, all future occurrences or the entire series. All-matching expansion must be reviewed separately. Whole-class review is available only in studio context. The existing backend remains authoritative for every eligibility decision.

The review separates eligible from blocked records and paginates compact rows with expandable financial, credit, booking, calendar, notification and dependency consequences. Permanent deletion explicitly names the eligible count and states how many blocked records will remain. There is no fallback operation. Archive and void preserve history; deletion retains its immutable snapshot and audit, accessible from batch results.

Acceptance switches to results, never a generic completion message. Waiting, processing, completed, skipped/blocked, conflicted, failed and external synchronization pending counts remain separate. Failed-only retry retains the original approval. Conflicts and expired reviews require a fresh review. A preview's idempotency key survives transport retry; execution uses a stable job-specific key; a manual retry intent keeps its key until its response is known.

The `lessonBatch` URL parameter reopens the persisted job without executing it. Browser Back closes a newly opened batch. An identity/studio/student-scoped session shortcut stores only the latest job ID, never a review token or lesson content. Account changes remount private state and identity-scoped query keys. Failed authorized reads suppress cached previews. Existing dialogs provide Escape, focus trapping and focus restoration.

After committed successes, the interface refreshes lesson candidates, bookings, finance, messaging, work, credit accounts and invoices. It preserves URL filters/page and does not reset scroll. Include archived exposes archived records for restore. Student and guardian actors have no batch controls and cannot call the coach commands or read deleted history.

## Small additive read-contract extension

`20261014224415_lesson_bulk_review_context.sql` changes only existing authorized reads. Progress now returns the owning coach's original review context/token, exact waiting/processing counts, and authorized student names. Candidate rows include authorized names and archival state. Actor ownership, current studio membership, service-only grants, eligibility, frozen fingerprints, mutations, workers and financial policy remain PR #39's implementation. No raw private table or worker claim token is exposed. Migration order requires the entire dependency stack; no production application is assumed.

The live list routes request identity/student context rather than broad lesson/work/finance snapshots. Opening existing header authoring workflows or lesson details restores their required domains. The legacy query mode and existing global activity snapshot remain compatible and can still fetch broad collections; this PR does not claim to finish the master plan's application-wide bounded-read migration.

## Verification and evidence

Local validation: **729 tests across 113 files passed**, including 102 actual migration-backed credit/occurrence/bulk database tests. Typecheck, quiet lint, secrets, build and bundle checks passed; formatting is checked after the final edits. Exact final-head isolated CI results and screenshot artifacts are recorded in the draft PR description and linked checks. New authenticated journeys use actual commands and workers against disposable fixtures: selection and exclusions, mixed physical deletion with protected financial history, archive/restore, URL reload, transport replay, partial failure/conflict recovery, recurring/shared prepaid/class review and a frozen 4,999-item review from 5,000 matching lessons. The large-review browser receives only bounded pages. Real separate-session races and all #36–39 regression tests remain required.

Screenshots are attached to the isolated browser run: deletion review at 320/390/768/1440, restored list, partial results, occurrence review and tablet large review. Accessibility checks require zero serious/critical axe findings in the new list/dialog flows; keyboard Escape/focus and responsive overflow are also checked.

Windows has no running local PostgreSQL container. Full migration replay/lint/types, pgTAP, real concurrency and authenticated browser evidence must come from isolated CI; pending checks are not described as passed. Existing provider-dependent Stripe verification remains blocked without isolated credentials. External Google/email delivery is not exercised. Maintenance retains the existing five-minute cadence and bounded worker batches, so large accepted jobs can take multiple invocations. No processing-time estimate is promised.

## Changed-file inventory

- Shared interface: `src/components/LessonBulkList.tsx`, `LessonBulkWorkspace.tsx`, `LessonBulk.css`, `src/hooks/useLessonSelection.ts`, `src/domain/lessonBulkPresentation.ts`; `Primitives.tsx` and its keyboard regression keep native disclosure summaries inside the dialog focus trap and exclude collapsed controls.
- Integrations and context: `src/components/LessonCalendar.tsx`, `src/features/coach/StudentWorkspace.tsx`, `StudentWorkspaceLessons.tsx`, `StudioLessons.tsx`, `BookingCenter.tsx`, `routeDomains.ts`.
- Read contracts: `src/domain/lessonBulk.ts`, `supabase/migrations/20261014224415_lesson_bulk_review_context.sql`.
- Verification: selection and route-domain tests, credit/invoice database tests, `supabase/tests/lesson_bulk_management.sql`, `e2e/lesson-bulk-interface.spec.ts`, `e2e/support/lessonBulk.ts`.
- Delivery: dependent-base CI allowlists, the Node typecheck include for shared review labels, and this document.

## Review checkpoint and next scope

Stop at the draft PR 1.5 review checkpoint. **PR 1.6 remains next:** simplify Student Overview, Household, Payments and understandable credit controls. Navigation, Materials 2.0, connected coaching, studio operations and final acceptance remain in the approved six-wave plan.
