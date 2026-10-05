# Lesson operational intelligence

Feature PR: [#26](https://github.com/coach-sudo/Studio-Portal/pull/26), based on `main` at `d4063d608d8dcd20ea624c6458d37de2fcfa5939`. The PR's exact head/checks are the release authority. This document does not authorize merge, a production migration, publication, unlocking, or V2 enablement.

## Architecture and source of truth

- `lessonReadiness.ts` is the deterministic shared read model for financial coverage, payer, preparation, confirmation/reminder history, Calendar/Meet readiness, and actionable issues. Today, Lesson Hub and the coach financial summary reuse it.
- `packageForecast.ts` projects applicable future coverage using the actual credit ledger, package definitions, service/duration/provider restrictions, expiry and auto-apply. Existing reservations are not counted twice. Projection never consumes credits or charges a card.
- `studentFinancialSummary.ts` deduplicates balances for lessons sharing a booking, includes historical outstanding lessons, and uses a recorded booking due date when present. Unknown/reconciliation states remain explicit; an unrelated account payment is never matched to a lesson.
- `paymentResponsibility.ts` and `notificationRecipients.ts` separate permission from primary responsibility. The server's `notification-recipients.ts` is the shared event-aware boundary. A finance-permitted primary payer does not thereby receive private work. Minors never become default billing recipients.
- `bookingGuestRecipients.ts` handles the pre-linked booking stage using only explicit booking identities: adult guest or a minor's explicit guardian for billing. No guest is granted private lesson/work access.
- `automationRules.ts` evaluates ten constrained families. `automation-engine.ts` queues decisions into existing `outbox_messages`, records explanations in `automation_runs`, and never calls Gmail.
- Existing `outbox-worker` and Gmail remain the sender. `delivery_attempts` remains delivery history; Inbox remains human conversation. There is no second queue, household model or payment ledger.
- Server projections use generated database types, paged financial rows and explicit database-to-domain mappings. They do not import the browser repository or demo snapshot.

## Additive schema

CLI-generated migration: `20261005014016_lesson_operational_intelligence.sql`. It has **not been applied to production**.

| Addition                                       | Purpose/security                                                                                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three `linked_contacts` booleans               | Primary payer, primary scheduling contact, financial escalation; false defaults preserve existing contacts and permissions. Partial unique indexes enforce one primary per student. |
| `automation_rules`                             | Ten fixed keys, modes, constrained configuration, versioning. Coach SELECT via RLS; writes only through validated coach API/service role.                                           |
| `automation_runs`                              | Decision explanations, recipient/suppression evidence, entity, correlation, outbox references and state-fingerprint dedupe. Coach-only SELECT/RLS; no portal/anonymous write.       |
| Outbox presentation/state fields               | HTML fallback, suppression reason, recipient intent, rule reference and entity snapshot. Existing queue and history are retained.                                                   |
| Initializer/authoritative suppression triggers | Seed rules for existing/new studios and cancel stale future queue entries after payment/cancellation/rescheduling. Empty search path; no PUBLIC/anon/authenticated execution.       |

The full migration chain, RLS/privilege assertions and generated-type diff run on the free isolated GitHub Docker stack. Local Docker is unavailable on this Windows host; no elevated installation, hosted test database, project upgrade or paid resource was created. The new pgTAP file contains 29 assertions, in addition to the existing database suite.

## Rule library and compatibility

Modes are `off`, `draft`, `automatic`, and `automatic_with_escalation`.

| Family                  | Trigger/audience                                                                                         | Initial state                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Booking confirmation    | Confirmed booking; permitted scheduling recipients                                                       | Retains legacy master/confirmation switches        |
| Lesson reminder         | Configured hours before scheduled lesson; scheduling recipients                                          | Retains legacy master/reminder switches and timing |
| PAYG payment due        | Recorded due/partial balance; permitted payer                                                            | Off                                                |
| Past-due follow-up      | Recorded arrears; payer and permitted escalation contacts                                                | Off                                                |
| Payment failure         | Matched booking payment failure; permitted payer                                                         | Retains legacy master switch                       |
| Package low balance     | Available credits at configured threshold; permitted payer                                               | Retains legacy master switch                       |
| Forecast shortfall      | Applicable scheduled lessons exceed credits; permitted payer                                             | Off                                                |
| Package expiration      | Active unused credits within configured warning window; permitted payer                                  | Retains legacy master switch                       |
| Missing financial setup | Upcoming financial/payer review issue; established coach Auth identity                                   | Off                                                |
| Delivery failure        | Failed existing outbox item, including guest/invite/campaign without student; established coach identity | Off                                                |

New billing/forecast/coach-alert behavior is not silently enabled. The old automated-email master switch remains authoritative. Legacy editable defaults remain under collapsed **Legacy email defaults and templates**; structured cards are primary.

Payment-due rules support initial/follow-up/pre-lesson stages through configurable positive `hoursBefore` values (up to six), with optional later coach escalation. Evaluation schedules future stages and at most the latest missed pre-lesson stage; it never replays every missed reminder. Past-due follow-up is a stable **once-per-lesson** stage, including completed lessons with recorded arrears, stopping when resolved. No implicit payment deadline is invented.

The old maintenance behavior that automatically cancelled a lesson after seven days of payment failure is removed, as expressly required by the brief. Past-due coach exceptions replace cancellation. Other existing maintenance/finance operations are preserved.

The five existing event producers retain delivery ownership during compatibility. Explicit rule evaluation shares confirmation/reminder/failure/package warning dedupe keys with those producers. The existing partial outbox unique index remains unchanged: atomic INSERT handles only its specific `23505` duplicate, because a PostgREST upsert cannot infer the index predicate. Other database errors still fail and are not hidden.

The scheduled worker uses a shared ten-second evaluation deadline, at most eight evaluations, four candidates per rule, cached per-student projections, and rotating rule/entity selection. It excludes identical evaluations from the recent twenty-minute window. New lesson candidates cover the next thirty days; recorded arrears also cover the previous thirty days. These bounds deliberately protect the 30-second scheduled Function budget. Delivery claims five messages per run; additional queued items remain for subsequent runs. This is bounded periodic processing, not a guarantee of instantaneous delivery at large backlog sizes.

## Suppression and safe actions

Authoritative triggers promptly cancel future billing/reminders after recorded payment, waiver/credit reservation, cancellation or rescheduling. Before dispatch, and again after provider-token acquisition, current state is checked for payment/credits, renewed package, changed package warning stage, preferences, permissions, rule/master switch, current timing and duplicate stage.

Cancelled entries remain with reasons; they are not deleted. Runs explain unresolved recipients, suppressed conditions, mode, financial state, selected/suppressed recipients, outbox references and correlation. Evaluation failures persist a safe code; provider failures use sanitized user-facing errors and correlation logs.

Coach timeline actions are version guarded. Send now/retry **queue** through the normal worker and cannot bypass current-state checks. Draft mail requires explicit review/send; switching a rule to automatic does not silently send previously reviewed drafts. Off cancels associated future queue entries. Primary contact assignment remains permission constrained and database unique even during concurrent edits.

Critical compatible confirmation/change/cancellation/failure events retain existing mandatory-event behavior, but never bypass recipient permission. Ordinary reminders/package notices honor preferences. Account-access emails also pass the current recipient boundary.

## Email links and presentation

`portal-url.ts` resolves production to `https://portal.d-a-j.com` using trusted deployment configuration, never a request Origin. Preview URLs use trusted deployment metadata; the run-local fixture origin is allowed only in explicitly isolated non-production configuration. Production hosts, credentials in URLs, arbitrary protocols/origins and missing preview metadata are rejected.

Token-scoped `/booking/:token` management remains token scoped. Authenticated deep links use normal authorization/RLS; private financial/email/authorization data is not appended to query strings. Old misspelled `portal.daj.com` copy is rebuilt through the trusted origin.

Shared presentation provides escaped HTML and meaningful plain text, one relevant CTA, signoff/footer and a configured logo at the bottom. Private stored logos are signed at delivery, not embedded as an expiring URL when a future email is queued. SQL note/practice/invite/campaign producers also pass the shared final presenter. Meet URLs are not placed in reminders early.

Blank structured templates retain default/current content. Common variables are `{{studioName}}`, `{{studentName}}`, `{{manageUrl}}`, `{{renewUrl}}`; lesson producers also supply their service/time context and reminder hours, and package producers their package/credit/expiry context. Destination and recipient policy are not user-editable escape hatches. Coach alerts link to the coach workspace, not the student's finance route.

Default PAYG copy becomes a stronger, still courteous request at the final two-hour stage: settle the recorded balance or contact the coach about an arrangement. It never threatens automatic cancellation, adds a charge, or invents a penalty. Coach escalation retains separate review instructions; custom authored copy remains authoritative.

## Coach surfaces and query ownership

| Surface          | Before                                      | Now                                                                                                                                |
| ---------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Home/Today       | Prep/payment/message checks dispersed       | Existing workflow plus exception totals and compact readiness; full payer/coverage/prep/logistics details expand in context        |
| Lesson Hub       | Work and finance required separate checks   | Shared readiness beside existing contextual note/practice/material actions                                                         |
| Student Account  | Access/contact permissions only             | Explicit responsibility distinct from permission, financial setup and coach-only communication timeline                            |
| Student Payments | Ledger/package controls                     | Shared setup, balance, recorded due timing, safe saved-method summary and projection before existing controls                      |
| Communication    | Internal outbox mainly in recovery settings | Student-associated upcoming/recent/suppressed email, related lesson, preview, delivery history, safe cancel/send/retry             |
| Email Settings   | Wall of template fields                     | Ten rule-specific cards, constrained editor/test dialog, mode/trigger/audience/conditions/stops/escalation/content/recent evidence |

Timeline queries use exact counts, server filtering/order, page size 25, abort signals and retained previous page; one-page/empty controls are hidden. Delivery history loads only for the selected message. Rules/history are coach RLS queries; package choices load only while testing a package rule. Queries retain PR2 ownership and targeted invalidation. Route/refetch tests verify the covered lesson/finance/messaging grouping remains within eight initial requests and at most two active targeted refetches.

Unresolved/group financial information is intentionally marked for reconciliation instead of assigning an arbitrary participant's booking/payer. The Account timeline is student-associated mail; shared class-wide rows without a student remain in the existing global outbox/lesson workflow. No portal user receives the internal timeline or rule history.

## Stale/redundant element audit

The feature and its adjacent coach surfaces were reviewed for unused controls, stale queued actions, duplicate presentation and obsolete code. Confirmed unused `.automation-card`/card-header/action selectors and duplicate preview/card declarations were removed. Shared financial labels now live in one presentation module, rather than making one React component depend on another for constants. The booking-email API no longer accepts an unused request-origin argument: all four producers use the trusted origin boundary. The Settings form uses an explicit React event type. The expanded axe suite also exposed the coach monogram's white-on-gold contrast; it now uses the existing dark ink without changing layout or branding.

Necessary compatibility is deliberately retained: the collapsed legacy templates/master switch still govern established email behavior; existing recovery/outbox controls have a different scope from the student timeline; canceled/suppressed rows remain delivery history. New rule editors show only relevant fields. No unused second queue, alert table, household model or payment ledger was introduced. This is a scoped audit, not a claim that every pre-existing repository warning or historical feature is obsolete. Existing unrelated lint warnings remain reported; no historical records, plugins or old PRs were removed.

The existing seven-day delivered-credential retention job now clears both plain text and the new stored HTML rendering, retaining the outbox row/status/history. Regression tests preserve queued/recent credential messages and unrelated email, and require purge failures to surface. No production retention job or manual data cleanup was run during implementation.

## Verification and visual evidence

The authoritative exact-head workflows are **Production checks** (`verify`, `migrations`) and **Deployed browser checks** (`smoke`, `deployed-suite`) on PR #26. The latter runs the original thirteen journeys plus the fifteen-step operational coach journey and a mobile operational surface journey.

Local reproduction established a Netlify CLI 27.8.0 proxy defect: a valid API 403 was retried as `.html` and `/index.html` static paths, obscuring the original authorization response with 404. The isolated workflow applies a version/source-guarded patch only to its disposable CLI, excluding `/api/` from static retry. Application routing/authorization remains unchanged, and the guardian assertion still requires 403 before privileged access. Patch tests retain non-API fallback, check idempotence, and reject unknown runtime source. Visual review also corrected Today status overlap and cramped Account household/timeline controls, with desktop/mobile name-width assertions.

Operational checkpoints cover paid/credit/due readiness, primary payer and minor protection, independent contact permissions, shortfall, timeline, payment/cancellation/reschedule suppression, draft/automatic queueing, retained audit, canonical preview CTA, guardian RLS/API denial, keyboard focus restoration, axe and mobile reflow. No axe rule is disabled. The cancellation checkpoint is not undone to test rescheduling: a separate scheduled fixture goes through the normal tracked SQL command and production queue helper. Google provider interaction is isolated there, not claimed as a real Calendar test.

The stateful operational journey does not retry against its own already-mutated fixture. Existing journeys retain their retry policy. Each isolated coach visual context has its own login/session; the future Today clock is limited to that view and then restored to real time. Failed-run diagnostics upload only SQLSTATE/static categories, never raw Function logs or credential files.

Evidence filenames in the full deployed-browser artifact:

- `coach-today-desktop.png`, `student-account-desktop.png`, `communication-timeline-desktop.png`
- `student-payments-desktop.png`, `automation-settings-desktop.png`
- `today-mobile.png`, `account-mobile.png`, `payments-mobile.png`, `settings-mobile.png`

Full-page Account mobile evidence includes its communication timeline. Screenshots/traces use only ephemeral namespaced records. Cleanup compares exact public, Storage, Auth-user and Auth-identity baselines, restoring rule edits and leaving zero E2E identities.

| Gate                                  | Evidence                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Vitest/component/domain/server tests  | Full suite required; exact final total is recorded in PR/check output; final implementation contains 422 tests |
| TypeScript / ESLint / Prettier        | Required; lint passes with existing repository warnings, not zero warnings                                     |
| Production build / bundle gate        | Required in production-shaped CI, unchanged warning/failure limits                                             |
| Secret scan                           | Required, no backup/password/provider credential in Git                                                        |
| Dependency audit                      | High-severity gate passes; one LOW existing DOMPurify advisory remains, documented below                       |
| Reset/lint/pgTAP/RLS/types            | Required isolated GitHub Docker chain; generated types must match                                              |
| Desktop/mobile/axe/15 new checkpoints | Required `deployed-suite`; blocked provider tests must remain explicit                                         |
| Exact fixture cleanup                 | Required, including zero E2E Auth users                                                                        |

**BLOCKED — isolated Stripe test-mode credential unavailable.** Journey 08's deterministic payment/package UI still runs, but actual Stripe Checkout is not reported as passed. No production Stripe credential or live charge is used. Real staging Gmail/Calendar delivery is not configured; queue transitions/shared provider mocks are verified instead of sending uncontrolled mail.

The audit now reports [GHSA-p98j-92pf-mc4p](https://github.com/cure53/DOMPurify/security/advisories/GHSA-p98j-92pf-mc4p), LOW, affecting the existing pinned DOMPurify 3.4.15. The documented attack needs `IN_PLACE` plus node-removing after-sanitize hooks; repository uses string sanitization and neither prerequisite. That is a source-based applicability assessment, not a claim of zero vulnerabilities. Recommend a separate narrow 3.4.16 patch; no unrelated dependency upgrade is included here.

## Rollback and manual product review

Keep new families off for initial rollout. Disable affected rules or the existing automated-email master switch and revert the feature code if necessary. Do not destructively reverse additive schema, remove linked contacts, rewrite ledgers or delete outbox/audit history. Existing production publishing remains locked; production migrations and application release require separate explicit authorization. V2 rollout is not authorized by this PR.

For review, use ephemeral coach fixtures for new Today/Account/Payments/Settings behavior. Compare to current production UX using an existing authorized tester session **read-only**: no fixture creation, bookings, messages, uploads, payments, contact edits or settings changes. Never copy the production tester password into logs, screenshots or documentation. Inspect payer versus work permission, expand readiness, preview a draft, confirm resolved-state send/retry is rejected, inspect mobile reflow/keyboard return focus, and review email CTA/footer with images disabled.

No feature migration, production data mutation, production environment change, V2 enablement, production publication, unlock, merge or paid infrastructure creation occurred during this feature work. Earlier separately authorized publication of the baseline is not a deployment of this feature.
