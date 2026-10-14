# PR 1.3 — Occurrence-safe lesson changes

## Dependency and release boundary

This branch, `codex/occurrence-safe-lesson-changes`, starts at PR #37's exact head `0badcc648ec715e20c2be7849d0bdbd8ec0955e0` and targets `codex/credit-lifecycle-reliability`. The dependency chain is [#36](https://github.com/coach-sudo/Studio-Portal/pull/36) → [#37](https://github.com/coach-sudo/Studio-Portal/pull/37) → PR 1.3. Both dependencies were open drafts with successful required checks when verified on October 14, 2026. PR #36 head: `f99f8cc0b7ae209e27562014e0743f39052f1dad`.

Main remains `6df35d700cc13d60ceab3e92293635575479ec4d`. Neither dependency is assumed applied in production. The new additive migration must follow both dependency migrations. Historical migrations are unchanged. Every commit and the draft PR title contain `[skip netlify]`; CI uses the isolated Supabase/Netlify stack. No migration, account adjustment, production publication, merge, or live communication is authorized.

Source of truth: [master plan](studio-portal-modernization-master-plan.md), [credit lifecycle reliability](credit-lifecycle-reliability.md), [authoritative diagnostics](credit-coverage-diagnostics.md).

## Supported behavior

| Operation                       | Scope and consequences                                                                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coach cancellation/rescheduling | Defaults to one exact occurrence. Shared booking dates and payment history stay intact; lifecycle cancellation occurs only when no active occurrence remains.                                                                      |
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

Calendar claims have lease tokens, claimed lesson versions, and persistent first-attempt evidence. A stale completion retains any acquired external ID but leaves newer projection work queued. Expired claims recover. Deterministic event IDs recover lost insert responses; current etags protect remote mutations. Missing known events and recurring masters require review. Token/provider failures stay retryable per item.

An in-flight external request cannot be rolled back atomically with PostgreSQL. A simultaneous change may briefly appear remotely until the queued latest projection completes. This is observable recovery, not a claim of exactly-once external delivery. [Google's event insert contract](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) and [conditional resource updates](https://developers.google.com/workspace/calendar/api/guides/version-resources) support the remote identity/version strategy.

Notification intents freeze affected participant/student IDs. Queue retries use the same effect ID; worker claims and backoff isolate failures. Only the affected lesson's reminders are superseded. Booking confirmations create reminders with an exact occurrence and time snapshot. Permission and mandatory-notification policy still resolves through existing recipient helpers, templates, outbox, and dispatch eligibility. Removed participants and superseded snapshots cannot receive active lesson reminders. No new outbound communication policy is introduced.

## Verification evidence

Initial local validation: 58 PGlite database tests against the dependent diagnostic/lifecycle/occurrence stack; calendar provider mocks cover conditional single-event deletion, recurring-master refusal, obsolete claims, lost insert response recovery, and token failure. Full-schema pgTAP, three observed two-session PostgreSQL races, and an authenticated desktop/mobile coach review with portal denial are wired to isolated CI.

Windows has no running Docker/Podman PostgreSQL environment. Full-schema, real concurrency, generated-type parity, and authenticated browser evidence must come from isolated CI, not PGlite. Live Google/Stripe/email end-to-end checks require isolated provider credentials and remain outside this delivery's authority.

The final validation record and draft PR identify the exact commit, completed checks, remaining limits, and readiness for PR 1.4. Production activation requires separate release authorization.
