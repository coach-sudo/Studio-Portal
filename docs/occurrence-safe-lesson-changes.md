# PR 1.3 — Occurrence-safe lesson changes

## Dependency and release boundary

This branch, `codex/occurrence-safe-lesson-changes`, starts at PR #37's exact head `0badcc648ec715e20c2be7849d0bdbd8ec0955e0` and targets `codex/credit-lifecycle-reliability`. The dependency chain is [#36](https://github.com/coach-sudo/Studio-Portal/pull/36) → [#37](https://github.com/coach-sudo/Studio-Portal/pull/37) → PR 1.3. Both dependencies were open drafts with successful required checks when verified on October 14, 2026. PR #36 head: `f99f8cc0b7ae209e27562014e0743f39052f1dad`.

Main remains `6df35d700cc13d60ceab3e92293635575479ec4d`. Neither dependency is assumed applied in production. The new additive migration must follow both dependency migrations. Historical migrations are unchanged. Every commit and the draft PR title contain `[skip netlify]`; CI uses the isolated Supabase/Netlify stack. No migration, account adjustment, production publication, merge, or live communication is authorized.

Source of truth: [master plan](studio-portal-modernization-master-plan.md), [credit lifecycle reliability](credit-lifecycle-reliability.md), [authoritative diagnostics](credit-coverage-diagnostics.md).

## Supported behavior

| Operation                       | Scope and consequences                                                                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coach cancellation/rescheduling | Defaults to one exact occurrence. Shared booking dates and payment history stay intact. Unaffected scheduled or completed occurrences preserve booking validity; ongoing contracts also remain valid until explicitly stopped.     |
| Reviewed selected IDs           | Frozen explicit IDs and dependency fingerprints; added dependencies or version changes reject the entire interactive request.                                                                                                      |
| Future/entire series            | Actual IDs and dates are reviewed. Only explicit future/series **cancellation** stops generation. Historical, protected, or ambiguous items block confirmation. Rescheduling preserves local wall-clock spacing and each duration. |
| Whole class                     | Requires explicit studio-level class review. Student-record operations cannot change the whole class.                                                                                                                              |
| Booking withdrawal              | Affects that booking's scheduled participations only. Other class participants, completed occurrences, and their financial records remain intact.                                                                                  |
| Shared prepaid or invoice line  | Ambiguous occurrence settlement is blocked with booking/invoice review guidance. No guessed financial allocation.                                                                                                                  |
| Provider-linked changes         | Unresolved synchronization conflicts and reserved-credit expiry block changes. External recurring masters are never PATCHed or DELETEd by the calendar worker.                                                                     |

Interactive multi-occurrence commands are limited to 100 reviewed occurrences in one transaction. This is not the upcoming 5,000-item bulk job implementation. PR 1.4 will reuse `lesson_ops.assess_change` and the existing occurrence mutation core, add persisted previews/jobs and revalidation, and support cancellation, archival, voiding, and actual eligible-record deletion. PR 1.5 adds shared selection/review/results surfaces. PR 1.6 simplifies the student record and financial controls.

## Financial and transaction invariants

The existing append-only cancellation and expired-credit policies remain authoritative. Returning a reservation requests PR 1.2 recovery; rescheduling preserves valid reservations and checks expiry before mutation. Multi-occurrence changes finish changing all occurrences before allocating upcoming credits, avoiding artificial version conflicts halfway through a batch. Results include PR 1.2's applied/already-covered/skipped/failed diagnostics and durable recovery intent.

Commands serialize scheduling before student, chronological lesson, booking/invoice, and package-lot work. Review compares current dependency fingerprints under financial locks. Receipts bind actor, studio, request, version, and idempotency key. An execution replay is checked before external calendar conflict checks. Mutation, audit, and notification intent commit together; external projection and delivery remain separately pending. The periodic generator shares scheduling serialization and rechecks series state after waiting.

The old class-offering deletion handler no longer physically deletes its lesson history. Class history must use reviewed changes; eligible deletion belongs to PR 1.4.

## Calendar and communication

Calendar claims have lease tokens, claimed lesson versions, and persistent first-attempt evidence. A stale completion retains any acquired external ID but leaves newer projection work queued. Expired claims recover. Deterministic event IDs recover lost insert responses; current etags protect remote mutations. Missing known events and recurring masters require review. Token/provider failures stay retryable per item. An open synchronization conflict invalidates a claim and prevents successful acknowledgment, including when the conflict was recorded after the claim began.

An in-flight external request cannot be rolled back atomically with PostgreSQL. A simultaneous change may briefly appear remotely until the queued latest projection completes. This is observable recovery, not a claim of exactly-once external delivery. [Google's event insert contract](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) and [conditional resource updates](https://developers.google.com/workspace/calendar/api/guides/version-resources) support the remote identity/version strategy.

Notification intents freeze affected participant/student IDs. Queue retries use the same effect ID; worker claims and backoff isolate failures. Only the affected lesson's reminders are superseded. Booking confirmations create reminders with an exact occurrence and time snapshot. Permission and mandatory-notification policy still resolves through existing recipient helpers, templates, outbox, and dispatch eligibility. Removed participants and superseded snapshots cannot receive active lesson reminders. No new outbound communication policy is introduced.

## Verification evidence

Verified CI checkpoint: `dc6a7fd7363171c5a3a93a55c5c5473f3826972f`, October 14, 2026. [Production checks](https://github.com/coach-sudo/Studio-Portal/actions/runs/38629071271) and [authenticated browser checks](https://github.com/coach-sudo/Studio-Portal/actions/runs/38629071283) passed on the complete dependent stack.

- 686 unit/integration tests across 111 files passed, including 67 PGlite credit/invoice/occurrence regressions with the actual booking financial triggers loaded.
- Complete isolated migration replay, SQL lint for `public`, `credit_internal`, and `lesson_ops`, generated-type parity, and 135 pgTAP assertions across six files passed.
- Four separate-session PostgreSQL races passed with observed contention: cancellation versus coverage; overlapping reviewed execution/replay; stale calendar completion versus a newer lesson version; booking withdrawal versus coverage. PR 1.2's concurrent grant/replay and repeated-scan checks also passed.
- 47 Playwright checks passed; one Stripe checkout check was blocked because an isolated Stripe test key was absent. Authenticated coach occurrence review, cancellation, rescheduling, stale review rejection, and portal-role denial passed. The new journey checks desktop and 390 px presentation, axe, and overflow; the existing suite also covers mobile Chromium.
- Fixture cleanup restored public data, private lesson-operation data, storage, and Auth to their pre-fixture baselines.
- Lint, formatting, typecheck, build, bundle budgets, and secret checks passed. Existing lint/CSS warning thresholds are retained; failure budgets are unchanged.

The final post-checkpoint synchronization-conflict guard adds one PGlite regression: all 68 database tests passed locally. Final-head CI results are reported in [draft PR #38](https://github.com/coach-sudo/Studio-Portal/pull/38); the checkpoint above identifies already-completed evidence rather than assuming the subsequent run's outcome.

Windows has no running Docker/Podman PostgreSQL environment. Full-schema, real concurrency, generated-type parity, and authenticated browser evidence must come from isolated CI, not PGlite. Live Google/Stripe/email end-to-end checks require isolated provider credentials and remain outside this delivery's authority.

Provider calls are mocked in this validation. Live Google/Stripe/email behavior is not claimed verified. Browser evidence uses the isolated `VITE_QUERY_LAYER_V2=true` configuration; production feature flags are untouched. The unavoidable in-flight external synchronization window described above remains recoverable rather than transactionally atomic.

## Changed-file inventory

All paths below are changes relative to the exact PR #37 base, not duplicated dependency work.

| Area                                  | Files                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database and types                    | `supabase/migrations/20261014163444_occurrence_safe_lesson_changes.sql`, `supabase/tests/lesson_occurrence_safety.sql`, `src/types/database.generated.ts`                                                                                                                                                                  |
| Commands and validation               | `netlify/functions/_v2/lessons.ts`, `netlify/functions/booking-admin.ts`, `netlify/functions/_shared/schemas.ts`, `netlify/functions/_shared/http.ts`, `src/domain/lessonChanges.ts`                                                                                                                                       |
| Calendar recovery                     | `netlify/functions/calendar-worker.ts`, `netlify/functions/_shared/calendar-projection.ts`, `netlify/functions/_shared/calendar-projection.test.ts`                                                                                                                                                                        |
| Notification recovery                 | `netlify/functions/booking-maintenance.ts`, `netlify/functions/_shared/booking-notifications.ts`, `netlify/functions/_shared/lesson-notifications.ts`, `netlify/functions/_shared/lesson-notifications.test.ts`, `netlify/functions/_shared/outbox-eligibility.ts`, `netlify/functions/_shared/outbox-eligibility.test.ts` |
| Shared review interface               | `src/components/LessonChangeReview.tsx`, `src/components/RescheduleLessonForm.tsx`, `src/features/coach/StudentWorkspaceLessons.tsx`, `src/features/coach/StudioLessons.tsx`                                                                                                                                               |
| Regression and fixture infrastructure | `netlify/functions/_shared/credit-invoice-database.test.ts`, `netlify/functions/_shared/package-renewal-pricing.test.ts`, `scripts/test-lesson-change-concurrency.mjs`, `netlify/functions/e2e-fixtures.ts`, `e2e/lesson-occurrence-safety.spec.ts`                                                                        |
| Isolated checks and documentation     | `.github/workflows/ci.yml`, `.github/workflows/deployed-browser.yml`, `package.json`, `tsconfig.node.json`, `docs/occurrence-safe-lesson-changes.md`                                                                                                                                                                       |

## Review checkpoint and next work

PR #38 is a draft safety foundation for PR 1.4. Review the migration, shared-booking financial protections, and external recovery behavior before extending the same assessment/mutation core with persisted bulk previews and resumable execution. The 100-record interactive review cap does not satisfy the master plan's 5,000-record bulk requirement; that belongs to PR 1.4. Actual eligible-record deletion, archive/void operations, and bulk selection remain in PRs 1.4–1.5. Student simplification follows in PR 1.6. No later wave is removed from scope.

Implementation stops at draft review. Production activation requires a separately reviewed release package and explicit authorization; no merge, publication, production migration, reconciliation, or live message/payment has been performed.
