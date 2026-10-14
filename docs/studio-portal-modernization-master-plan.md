# Coach’D Studio Portal Modernization — Master Engineering Plan

**Baseline verified October 14, 2026.**

**Document destination:** `C:\Users\dariu\Desktop\studio-portal\docs\studio-portal-modernization-master-plan.md`

**Delivery status:** Approved for implementation on October 14, 2026. Saved before beginning PR 1. Production release actions remain unapproved.

## 1. Executive summary

Modernize the existing portal through six waves of small, reviewable PRs. Preserve its React application, Supabase authorization and ledger, Netlify commands and workers, canonical Library resources, booking safeguards, and communication infrastructure.

The first wave addresses financial reliability and immediate usability:

1. Establish authoritative credit eligibility and coverage diagnostics.
2. Repair inconsistent credit application paths and result reporting.
3. Make lesson changes safe for individual recurring occurrences.
4. Implement reviewed bulk cancellation, archival, and actual eligible-record deletion.
5. Simplify student records, Household, Payments, and account administration.

Subsequent waves consolidate navigation, add permission-aware search, deliver secure resource viewing and private study tools, connect lesson workflows, and improve every specified studio operation.

Two product decisions are settled:

- **Permanent deletion is limited to erroneous records without meaningful dependencies.**
- **Reading position, bookmarks, and private student notes belong in Materials 2.0.**

No production migration, financial reconciliation, outbound communication, merge, or publication is authorized by this plan.

## 2. Verified baseline and evidence limits

| Item                          | Verified state                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| Repository and default branch | `coach-sudo/Studio-Portal`; default branch `main`                                                   |
| Local and remote head         | `6df35d700cc13d60ceab3e92293635575479ec4d`; clean checkout                                          |
| Production project            | `studio-portal`, site ID `93829451-dbcf-4863-a07f-fa448cb17494`                                     |
| Published deployment          | `6ace53e7fc5a52ffa29128bc`, ready, same commit                                                      |
| Publication time              | October 13, 2026, 11:54 a.m. Eastern                                                                |
| Production health             | `/api/healthz` returned `ok`, production context, matching shortened commit                         |
| Local Netlify link            | `coachd-staging`, site ID `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`; intentional staging configuration |
| Production Supabase           | `htwthzshhilrjtqwprlo`, active; PostgreSQL 17                                                       |
| Applied migrations            | Match repository history through `20261008220659_bounded_legacy_material_snapshots`                 |
| PR #28                        | Closed, unmerged; do not import its branch as the implementation baseline                           |
| Latest main CI                | “Production checks” succeeded at the current commit                                                 |
| Open PRs                      | Older stacked PRs #11–18 and dependency PRs #3, #4, #23, #24, #30                                   |

Do not merge old stacked PRs into this initiative without comparing their effective changes against current `main`. Much of the architectural work they describe already exists in the current source.

The [current production commit](https://github.com/coach-sudo/Studio-Portal/commit/6df35d700cc13d60ceab3e92293635575479ec4d) and [successful main CI run](https://github.com/coach-sudo/Studio-Portal/actions/runs/38425864383) provide the release baseline.

### Verification completed during planning

- Source inspection across coach, student, guardian, public booking, Library, finance, communication, and settings workflows.
- Read-only production inspection of migration history, relevant triggers, function call paths, and lesson foreign-key dependencies.
- Public browser entry reached the production sign-in page.
- **61 tests passed across seven files**, including credit/invoice and Library SQL execution in PGlite, automatic-credit command tests, financial summaries, route domains, and content-density tests.

### Verification not completed

- Authenticated coach, student, and guardian browser journeys.
- Actual reproduction of the reported live automatic-credit failures.
- Full PostgreSQL migration replay, pgTAP, and concurrent-session tests in this environment.
- Fresh responsive or accessibility review of authenticated screens.
- Live Stripe, Google Calendar, or email delivery tests.

The browser had no authenticated session; staging fixture settings were absent; Podman could not connect. Existing screenshot documentation is historical evidence, not fresh proof of production behavior.

## 3. Architecture and constraints

### Preserve these foundations

- React 19, TypeScript, Vite, React Router, TanStack Query.
- Existing shared dialogs, drawers, writing areas, statuses, calendar, invoice components, and mutation hooks.
- Supabase RLS-backed reads and authenticated Netlify command boundaries.
- Existing financial concepts: dollar account credit, lesson credits, packages, reservations, invoices, settlements, and bookings.
- Canonical resources in `materials`, assignments and associations in `material_links`, existing metadata and collections.
- Existing Inbox, outbox delivery, notification preferences, and campaign infrastructure.
- Existing actor draft, approval, revision, and public publication model.

### Architectural constraints

1. **Route-specific queries do not guarantee bounded data.** The route snapshot RPC still aggregates entire visible lesson, note, assignment, finance, and communication collections for requested domains.
2. **Both query modes exist.** Preserve compatibility while migrating affected screens to explicit bounded reads. Confirm the deployed feature flag before removing the legacy path.
3. **Command envelopes include idempotency keys, but handlers differ in enforcement.** An envelope alone does not provide transactional replay safety.
4. **Some commands mutate data, then write audit records or queue messages separately.** New destructive operations must commit their record changes, audit evidence, and side-effect intent transactionally.
5. **Lesson deletion has dangerous database cascades.** Notes, messages, material links, participants, and calendar projections can cascade; assignments and imports can lose associations through `SET NULL`.
6. **Invoice and offering dependencies also use JSON or arrays.** Foreign-key checks alone are insufficient.
7. **Calendar and maintenance workers run every five minutes.** A setting being enabled does not establish immediate coverage or successful external synchronization.
8. **Current signed resource URLs last five minutes.** Preserve private storage and authorization; refresh URLs when needed without copying files.

Private files should retain the existing authenticated or time-limited access model documented by [Supabase Storage](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## 4. Current-state audit

Classification legend:

- **F:** Confirmed functional defect, established from source or schema; live reproduction is separately identified.
- **R:** User-reported issue requiring reproduction.
- **U:** Usability deficiency.
- **L:** Redundant or legacy interface.
- **N:** New capability.
- **O:** Optional future enhancement.

A source-confirmed defect below does **not** imply that its live production manifestation was reproduced.

| ID  | Area                     | Evidence and finding                                                                                                                                                                                                  | Class | Priority and disposition                                               |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------- |
| A01 | Automatic credits        | Reported unreliable coverage remains unverified in authenticated use.                                                                                                                                                 | R     | Critical: reproduce using isolated lifecycle fixtures.                 |
| A02 | Credit diagnostics       | Reservation functions return a package ID or null; account operations lack authoritative per-lesson skip explanations.                                                                                                | N     | Critical: shared diagnostic model.                                     |
| A03 | Credit preview           | `CreditAccount` clones frontend snapshot data and runs `reserveDemoCredits` to estimate live coverage.                                                                                                                | U     | High: replace with backend preview.                                    |
| A04 | Recurring conversion     | `command_make_lesson_recurring` creates occurrences without invoking credit reservation or an account scan. Production function inspection confirms this.                                                             | F     | High: immediate coverage evaluation after conversion.                  |
| A05 | Credit additions         | The credit-entry trigger updates account version only. The legacy grant command inserts credits without scanning upcoming lessons.                                                                                    | F     | High: consistent event handling and retry intent.                      |
| A06 | Mixed automatic settings | Reservation can fall back to package flags when account preference is null; the worker scans only account preference `true`.                                                                                          | F     | High: explicit mixed-state policy.                                     |
| A07 | Application counts       | Account-scan SQL increments `applied` when the reservation function returns an existing reservation. Package assignment forwards this count. The settings handler partially compensates using separate summary reads. | F     | High: count new reservations inside the transaction.                   |
| A08 | Credit worker            | One account error aborts the scan; sequential work lacks per-account failure results and durable progress.                                                                                                            | F     | High: bounded, resumable processing with isolated failures.            |
| A09 | Coverage presentation    | Reserved lessons appear, but uncovered lessons and their reasons do not. Repeated explanatory text competes with totals.                                                                                              | U     | High: coverage list and concise account summary.                       |
| A10 | Financial labels         | Coach Home sums positive dollar account credits and labels them “open balances.”                                                                                                                                      | F     | High: distinguish liabilities from prepaid dollar credit.              |
| A11 | Financial duplication    | `StudentFinancialSetup` appears on both Account and Payments; package forecasts and administration dominate these views.                                                                                              | U, L  | High: one financial summary and secondary administration.              |
| A12 | Household                | Contact rows already exist, but relationship, invitation delivery, access, payer, and scheduling responsibilities are mixed with numerous controls.                                                                   | U     | High: concise rows and deliberate Manage Access interaction.           |
| A13 | Invitation status        | Current badges emphasize delivery states such as “Sent”; these do not establish account activation or successful portal access.                                                                                       | U     | High: separate delivery, invitation, and access states.                |
| A14 | Student overview         | Overview uses legacy material/assignment snapshots, links Next lesson to the general list, and lacks the latest lesson-note takeaway.                                                                                 | U, L  | High: authoritative current-context summary and exact links.           |
| A15 | Today notes              | “Write note” navigates to the student's general Notes tab rather than the target lesson draft.                                                                                                                        | F     | High: exact lesson/editor link.                                        |
| A16 | Bulk lessons             | Student and studio lesson interfaces have individual actions; no reviewed bulk deletion operation exists.                                                                                                             | N     | High: backend eligibility, review, execution, and shared selection UI. |
| A17 | Recurring cancellation   | Cancelling one lesson can mark linked bookings cancelled, including a booking shared by other occurrences.                                                                                                            | F     | Critical prerequisite for bulk operations: occurrence-safe handling.   |
| A18 | Navigation               | Coach sidebar exposes eleven destinations, including overlapping Home and Today. Mobile More opens the navigation search.                                                                                             | U, L  | High: unified Today and grouped secondary navigation.                  |
| A19 | Global search            | Search filters navigation labels only.                                                                                                                                                                                | N     | High: bounded permission-aware record search.                          |
| A20 | Context continuity       | Roster and several list filters use local component state. Some attention actions link to general pages.                                                                                                              | U     | High: URL state and exact record links.                                |
| A21 | Library detail           | Canonical detail and assignment instruction reads already exist, but file access opens a separate tab.                                                                                                                | U, N  | Extend the existing detail experience into a study workspace.          |
| A22 | Current Work             | Canonical resource assignments coexist with legacy script tools and separate practice panels. Home summaries do not aggregate all canonical assigned resources.                                                       | L, U  | Consolidate presentation and summaries without replacing storage.      |
| A23 | Study tools              | Reading position, bookmarks, and private resource annotations are absent.                                                                                                                                             | N     | Required Materials 2.0 scope.                                          |
| A24 | Script archive           | Student script archive displays single-page controls with no-op pagination handlers and renders the full loaded archive.                                                                                              | F     | Replace with real bounded pagination.                                  |
| A25 | Lesson hub               | Coach and portal lesson hubs already connect notes, practice, preparation, and materials.                                                                                                                             | U     | Improve and share their behavior; do not create a competing hub.       |
| A26 | Scheduling               | Calendar, booking overview, setup, services, availability, classes, and recurring configuration share one seven-tab surface.                                                                                          | U     | Separate everyday operations from configuration.                       |
| A27 | Roster/onboarding        | Search, pagination, creation, import, and merge exist. Invitation and activation need a clearer combined operating view.                                                                                              | U     | Reuse operations; improve status, sorting, and context.                |
| A28 | Finance/invoices         | Branded invoices, PDF, partial payments, checkout locking, and package fulfillment exist. Financial hierarchy and pending-action visibility need improvement.                                                         | U     | Preserve these systems and strengthen presentation/verification.       |
| A29 | Inbox/notifications      | Existing shared messaging backend is appropriate; selected records, attention links, and delivery states need continuity improvements.                                                                                | U     | Exact conversation/message links and clear queued/sent/failed states.  |
| A30 | Guardian portal          | Permission-aware navigation exists. Some presentation paths use the first returned student and need multi-student verification.                                                                                       | R, U  | Explicit authorized student context; permission tests for each child.  |
| A31 | Actor Pages              | Draft and publication workflows exist. Studio list publication can be triggered directly without a dedicated review interaction.                                                                                      | U     | Reviewed publication with distinct draft/review/public states.         |
| A32 | Referrals                | Existing sharing and reward machinery is reusable; primary navigation prominence exceeds everyday coaching importance.                                                                                                | U     | Move to secondary navigation and simplify progress.                    |
| A33 | Campaigns                | Templates, recipient preview, and Review send already exist. Composition and history should follow shared patterns.                                                                                                   | U     | Preserve consent, unsubscribe, privacy, and confirmation protections.  |
| A34 | Settings                 | Section grouping exists, but URL initialization recognizes only the email panel; other panels cannot reliably deep-link.                                                                                              | F     | Parse and synchronize all supported section identifiers.               |
| A35 | Responsive/a11y          | Shared primitives and axe infrastructure exist; authenticated screens were not freshly reviewed here.                                                                                                                 | R     | Cross-role, keyboard, mobile, and tablet acceptance gates.             |
| A36 | Loading/performance      | Student records request broad domains regardless of tab; full snapshots remain a scaling constraint.                                                                                                                  | U     | Bounded record reads and lazy secondary sections.                      |

### Highest-priority additional discoveries

Beyond the reported problems, prioritize:

1. Shared-booking cancellation consequences — A17.
2. Dollar-credit/liability mislabeling — A10.
3. Incorrect newly-applied counts — A07.
4. Mixed legacy automatic-setting inconsistency — A06.
5. Worker failure isolation — A08.
6. Unbounded record loading and misleading archive pagination — A24, A36.
7. Settings deep-link behavior — A34.
8. Transactional audit and side-effect intent for destructive operations.

## 5. Final information architecture

### Coach navigation

| Primary destination | Route              | Contents                                                                                              |
| ------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| Today               | `/coach/today`     | Current/next lesson, day schedule, notes due, approvals, requests, financial exceptions, week preview |
| Calendar            | `/coach/bookings`  | Calendar, appointment list, bookings, recurring plans, operational exceptions                         |
| Students            | `/coach/students`  | Roster, onboarding, student records                                                                   |
| Inbox               | `/coach/inbox`     | Conversations and communication attention                                                             |
| Library             | `/coach/materials` | Canonical resources, collections, metadata, resource workspace                                        |
| Studio              | `/coach/studio`    | Payments, Actor Pages, Referrals, Campaigns, booking configuration, Settings                          |

`/coach` becomes a compatibility redirect to Today. Move useful Coach Home content into Today before replacing the dashboard.

Preserve existing finance, campaign, referral, actor, settings, class, and student URLs. Change navigation placement, not their availability. Preserve existing `/coach/lessons` and `/coach/notes` compatibility behavior, including query context.

Mobile navigation: Today, Calendar, Students, Inbox, More. More opens an actual grouped menu with Library, Studio destinations, and Search.

### Student navigation

Home, My Work, Schedule, Messages, permitted Payments, More.

Continue using `/portal/work`, `/portal/bookings`, and `/portal/inbox`; change visible labels without unnecessary route renaming. More contains Actor Page, Referrals, Settings, and published note history.

### Guardian navigation

Overview, permitted Student Work, permitted Schedule, Messages, permitted Payments, More.

When several students are authorized, show a persistent student selector. Store selected student in the URL and include it in query keys. Validate the selection against current authorization before loading data.

### Student record

Default tabs: Overview, Lessons, My Work, Notes, Household, Payments. Account administration and Actor Page remain accessible through the record menu.

Use `/household` for the concise contact view. Existing `/account` remains reachable as administration; old payer/access links should open the corresponding Household interaction.

Persistent header: identity, status, coaching focus, Add lesson, Write note, Assign practice, Add material, Message, record menu. On narrow screens use one Add menu and a separate Message action.

### Context rules

- Persist search, filters, sort, page, active view, selected student, and selected record in URL state.
- Keep return context and scroll position for record-to-list navigation.
- Opening a drawer adds a history entry; Back closes it.
- A direct record link must load the exact record independently of the current list page.
- Unknown or unauthorized records show a safe unavailable state without previews or identity leakage.
- Notifications, search results, and Today actions use one shared record-link resolver.

**Classification:** U, L, N.

## 6. Automatic lesson credits

### 6.1 Preserve financial policy

- One lesson credit covers one eligible lesson, regardless of service or duration.
- For group lessons, coverage belongs to the student's participation.
- Reserve earliest-expiring valid credits first; allocate to earliest upcoming lessons first.
- A package must remain valid strictly beyond the lesson start, consistent with current rules.
- Reservations are ledger debits. Completing an already-covered lesson must not debit again.
- Disabling automatic use preserves existing reservations.
- Existing cash, partial payment, waiver, refund, and pending checkout protections remain.
- Preserve the current cancellation treatment of returned expired credits.
- Reconciliation remains explicit and refuses ambiguous historical records.
- Do not redistribute existing valid reservations merely because a new earlier lesson appears.

### 6.2 Authoritative eligibility and diagnostics

Add a shared private SQL evaluator used by both reservation commands and authorized diagnostic reads.

The evaluator checks:

- Student/studio ownership and participation.
- Lesson lifecycle and automatic/manual mode.
- Existing net reservation.
- Ledger reconciliation requirements.
- Account preference, including mixed legacy state.
- Cash and booking payment coverage.
- Invoice checkout locks and payment processing.
- Package balance and validity at lesson start.

Expose an authorized, bounded `student_credit_coverage` read containing:

- Existing account totals and version.
- Automatic preference: enabled, disabled, or awaiting review.
- Per-lesson coverage state and authoritative reason code.
- Existing reservation and expiry where permitted.
- Projected coverage when previewing enablement.
- Counts of covered, eligible-unreserved, and uncovered lessons.
- Processing or failure state from coverage maintenance.

Reason codes include:

`no_available_credits`, `expires_before_lesson`, `cash_paid`, `partially_paid`, `payment_pending`, `already_reserved`, `reconciliation_required`, `auto_disabled`, `mixed_settings_review`, and `lesson_ineligible`.

Represent “already reserved” as covered, not as an unpaid lesson. Conflicting ledger/payment evidence becomes a review exception.

The backend evaluates chronological allocation across the complete relevant upcoming set before paginating diagnostic rows. Evaluating each displayed page independently would produce incorrect coverage forecasts.

### 6.3 Event-path repair

| Event                                 | Current state                                   | Required behavior                                                                    |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| Enable automatic use                  | Immediate SQL scan exists                       | Preserve confirmation; return authoritative newly-covered and skipped results        |
| Change credit total                   | Immediate scan exists when enabled              | Preserve reserved floor and append-only adjustment                                   |
| Legacy grant/addition                 | No immediate scan                               | Grant and coverage intent commit together; attempt immediate application             |
| Assign package                        | Separate package/ledger writes followed by scan | Atomic grant, replay safety, authoritative results                                   |
| Paid invoice package fulfillment      | Scan exists                                     | Preserve issued snapshots and exactly-once grant                                     |
| Package purchase, renewal, gift claim | Coverage calls exist                            | Verify every success/retry path and report pending coverage honestly                 |
| Create lesson/series                  | Account scan exists                             | Preserve; validate summaries and all occurrences                                     |
| Convert lesson to recurring           | Missing immediate scan                          | Evaluate every affected student after occurrences exist                              |
| Public booking                        | Per-occurrence reservation exists               | Preserve credits-required atomic rejection and pay-later protections                 |
| Reschedule                            | Reservation validity checked; no account scan   | Preserve valid holds; evaluate newly eligible uncovered lessons                      |
| Import/review provider lesson         | Direct insert/update paths exist                | Evaluate after confirmed identity, payment policy, and participation are established |
| Cancellation                          | Returns/retains credits                         | Recheck uncovered lessons after eligible credits return                              |
| Completion                            | Protects existing debit                         | Preserve no-double-consumption and refresh all relevant summaries                    |
| Background maintenance                | Enabled-account scan                            | Bounded recovery, per-account errors, durable retries                                |

Do not automatically spend studio credits against externally paid provider lessons. Preserve the existing payment-policy decision and classify uncertain imported coverage as requiring review.

### 6.4 Worker and transaction model

- Add a small `credit_coverage_jobs` queue keyed by student, storing requested/completed account version, retry state, and error metadata.
- Explicit command/event boundaries enqueue recovery intent; do not introduce recursive reservation triggers.
- Immediate commands evaluate coverage in the same financial transaction where feasible.
- Provider fulfillment records its grant and retry intent atomically.
- Workers process bounded batches, isolate account errors, retry with backoff, and retain a periodic enabled-account sweep.
- Use deterministic lock order: affected students, lessons, then package lots.
- Compute newly reserved counts from ledger inserts inside the transaction; never infer them from two unlocked summary reads.
- Keep mixed account preferences explicit. New automatic application awaits coach review; manual application remains possible when otherwise eligible.

### 6.5 UI

Payments shows Remaining, Available, Reserved, then **Use credits automatically** with one sentence of help.

Display covered and uncovered upcoming lessons with exact reasons and permitted next actions. “Apply eligible credits now” returns newly covered count, skipped counts/reasons, and refreshed totals.

The action must not silently enable automatic use. When disabled, offer Review and enable. A successful settings save and a completed coverage check receive separate status messages.

Student and authorized guardian views are read-only for the coach-managed preference.

**Classification:** F, R, U, N.

## 7. Bulk lesson management

### 7.1 Selection

Implement one reusable selection controller for student lesson lists, studio lesson lists, calendar agenda/list mode, and filtered results.

- Individual checkboxes and select-all-visible.
- Explicit “Select all matching results” with server count.
- Selection count, exclusions, clear action, and shared toolbar.
- Page changes preserve selected IDs.
- Filter or student-context changes clear selection and announce that change.
- Select-all-matching freezes IDs and versions at review time; later matches are never added.
- Maximum reviewed batch: 5,000 records. Larger selections require narrower filters; never truncate silently.

### 7.2 Distinct operations

| Operation             | Meaning and eligibility                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Cancel                | Change selected scheduled occurrences using the established financial policy; preserve records                                           |
| Archive               | Reversible removal of terminal records from normal coach lists; no financial or calendar effects                                         |
| Void erroneous record | Audited invalidation of an already-cancelled erroneous record with no unresolved financial obligation; preserve dependencies and history |
| Permanently delete    | Physical removal only of eligible dependency-free mistakes                                                                               |

For archival, store coach-view archival state separately from lesson lifecycle. Archival must not remove a student's historical record.

For voiding, add explicit void metadata rather than mislabeling it as deletion. Records remain inspectable through history. Voiding cannot reverse a payment, remove ledger entries, or erase authored content.

### 7.3 Exact permanent-deletion eligibility

A lesson must:

- Belong to the requesting coach's studio.
- Be scheduled or cancelled, not completed or late-cancelled.
- Be a native studio record without provider/import history.
- Have no package association or credit-ledger entries, including released entries.
- Have zero paid amount and no financially meaningful paid, waived, refunded, or partial-payment state.
- Have no invoice link, invoice-item reference, settlement reference, or pending checkout.
- Have no booking association or offering/class membership.
- Have no notes, assignments, material links, lesson messages, outbox communication, or integration-import association.
- Have no unresolved synchronization conflict or external calendar identity.
- Have no calendar work currently claimed or previously attempted.

Permit only creation-generated, booking-free participant rows for the lesson's own student. Those rows and an untouched queued calendar projection are operational scaffolding, not coaching history, and may be removed with the lesson.

Audit events are retained. Write an immutable deletion snapshot with actor, reason, batch ID, and original lesson details before deletion.

Check JSON and array references as well as foreign keys. Never use cascade deletion as the dependency policy.

### 7.4 Recurring and shared-booking safety

Default action scope is **selected occurrences**.

Provide separate explicit scope choices:

- This occurrence.
- Selected occurrences.
- All future occurrences.
- Entire series.

Expanded scope must show its actual IDs and count in the same review. Completed or protected historical occurrences remain ineligible for deletion.

Before bulk cancellation ships:

- Replace booking-wide effects in occurrence commands with occurrence-aware behavior.
- Keep a shared booking active while unaffected occurrences remain.
- Cancel only reminders and calendar events for affected occurrences.
- Preserve shared booking payment history.
- Block per-occurrence financial settlement when a shared prepaid arrangement cannot be allocated authoritatively; direct the coach to booking-level review.
- Stop future generation only when the coach explicitly selects the future/series operation.
- Preserve recurring-series records and audit history even when eligible erroneous occurrences are physically removed.

Student-scoped batches must not cancel an entire shared class. Skip shared-class records with a clear explanation and an Open class action. Studio-scoped class cancellation requires an explicit whole-class scope in the batch review.

### 7.5 Review and execution

Extend `/api/v2/lessons` with typed `preview_bulk`, `execute_bulk`, and retry commands.

Preview creates a coach-owned review snapshot containing:

- Operation, scope, count, frozen IDs, versions, and expiry.
- Dates, students, statuses, recurrence, and dependency counts.
- Financial effects and returned/retained credit policy.
- Calendar effects and potential notification recipients.
- Eligible and blocked items, each with a reason.

Use one confirmation for the reviewed batch. State permanent deletion clearly. Require a reason for cancellation, voiding, and deletion.

Execution:

- Uses persisted `lesson_bulk_jobs` and `lesson_bulk_items`.
- Binds the request to actor, studio, preview version, and idempotency key.
- Revalidates each record and dependency set inside its transaction.
- Skips changed records and reports conflicts.
- Commits mutation, audit, and side-effect intent atomically.
- Processes bounded chunks with resumable per-item results.
- Never retries successful items as new operations.
- Reports succeeded, skipped, failed, and synchronization-pending separately.

Preserve established notifications for actual cancellations and explain them in review. Archive, void, and dependency-free deletion send no student email. Calendar changes remain separately observable.

**Classification:** N, F, U.

## 8. Student record, Household, and Payments specifications

### Overview

Use a bounded `student_workspace_summary` read:

- Identity, current status, coaching focus.
- Exact next lesson and join/preparation action.
- Latest relevant coaching note or takeaway.
- Current script, canonical assigned resources, active practice.
- Pending help requests and approvals.
- Concise account and access exceptions.

Keep detailed goals and private context behind disclosure. Coach-private content never enters portal summaries.

Next lesson opens the lesson hub. Latest note opens the exact note. Current work opens the corresponding resource or assignment.

### Household

Default contact rows show name, relationship, email/phone, payer, scheduling responsibility, invitation state, and portal access.

Use separate states for:

- Invitation not created, queued, delivered, failed.
- Account activation, where authoritative evidence exists.
- Portal access enabled or disabled.

Editing contact identity and responsibility does not require opening all access settings.

Manage Access contains permissions, notification preferences, invitation/reset actions, and revocation. Reuse current linked-contact commands and protections. Preserve mandatory notifications and distinguish access revocation from contact removal.

### Payments

Show:

- Amount due, derived from invoices and uncovered financial obligations without double counting.
- Available dollar account credit, separately labeled.
- Remaining, available, and reserved lesson credits.
- Active package count and meaningful expiry/renewal exceptions.
- Unpaid invoices and pending checkout actions.

Secondary sections: Invoices, Packages and renewals, Payment history, Credit history, Adjustments, Reconciliation.

Use invoice totals for invoice-linked lessons. Count shared booking liabilities once. Unknown balances show Review required; do not display invented zeroes.

Move pricing configuration and detailed responsibility administration out of the default payment summary.

### Content standards

- No introductory paragraph when the title and controls already explain the task.
- Default cards contain a short value and, at most, one useful contextual sentence.
- Long authored content remains available through deliberate disclosure.
- Preserve financial consequences, destructive warnings, consent, privacy, and accessible names.
- Histories and large collections use actual pagination.
- Reuse a shared financial summary across coach, student, guardian, and Today surfaces.

**Classification:** F, U, L, N.

## 9. Navigation, search, and shared interactions

### Global search

Add an authenticated `studio_global_search` RPC using invoker authorization and existing row policies.

Search:

- Coach: authorized students, lessons, bookings, resources, notes.
- Student/guardian: only authorized lessons, work, resources, published notes, and permitted bookings.
- All roles: permitted destinations and actions.

Default: 250 ms debounce, two-character minimum for record queries, five results per entity group, thirty records maximum per response. Permit expanded paginated results by group.

Search note text on the server with sanitized snippets; never return unpublished notes to portal roles. Return resource identity and authorized detail routes, not signed URLs or file bodies.

Use cancellation of stale requests, identity-scoped query keys, and keyboard arrow/Enter navigation. Keep destination search available for empty queries.

### Shared interactions

Standardize:

- Page header and primary action.
- Bounded search/filter/list controls.
- Record drawer and full-page detail behavior.
- Save, dirty-state handling, and processing indicators.
- Review/confirmation patterns.
- Bulk toolbar and result panel.
- Consistent error, retry, and unavailable states.

Use existing primitives. Save notes, practice, preparation, resources, and completion independently. Saving content never implicitly sends or publishes it.

**Classification:** U, N, L.

## 10. Materials and Studio Library 2.0

### Resource workspace

Extend existing canonical resource and assignment reads. Include:

- Title, description, source/author, metadata.
- Shared coach instructions intended for learners.
- Assignment-specific instructions.
- Associated lesson, assignment, and published feedback.
- Coach-private notes only in authorized coach views.
- Viewer as the main content surface.

Use exact resource routes under coach and portal shells. Assignment context is explicit in the URL; validate that it belongs to the resource and selected student.

### Viewer

| Type                    | Implementation                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| PDF                     | Lazy-loaded PDF.js viewer with page navigation, zoom, fullscreen, and text search where a text layer exists |
| Text                    | Accessible text reader with zoom, search, and stable paragraph anchors                                      |
| Images                  | Image viewer with zoom and fullscreen                                                                       |
| Audio/video             | Native accessible controls; restore playback position where supported                                       |
| External links          | Safe provider embedding only for approved supported providers; otherwise Open source                        |
| Unsupported/unavailable | Clear fallback, permitted download/open-original, and retry where meaningful                                |

PDF.js is the justified new viewer dependency. Registry inspection currently reports `pdfjs-dist` 6.4.299 and Node requirements of `>=22.13.0 || >=24`. Pin a verified version and lockfile during the viewer PR; confirm build-runtime compatibility.

Disable PDF scripting. Do not render uploaded HTML or executable SVG inline. Sanitize external links and preserve CSP restrictions.

Reuse canonical files and the existing signed URL mechanism. Keep URLs in memory, refresh before expiry or after an authorization-safe failure, and clear viewer/query state on identity change. Do not persist file bytes or signed URLs in browser storage.

Image-only PDFs show that text search is unavailable; OCR is optional future scope.

### Private study tools

Add student-owned study state referencing existing resources and content identity:

- Last reading page/paragraph or playback position.
- Bookmarks.
- Personal notes.
- Page-linked notes for PDFs with reliable page identity.

Store study state and annotations in additive tables. Include owner user, student, resource, content identity, anchor, version, and timestamps.

Policies permit only the student's own identity. Coaches, guardians, and other students cannot read personal notes. Existing instructions remain separate.

Metadata-only resource edits preserve anchors. File/content replacement marks old anchors as belonging to the previous content; it does not silently attach them to a different page.

Autosave position after a short debounce; save note edits explicitly. Show saving, saved, and failed states. Retain annotations when resource access is removed, but suppress resource-dependent display until access returns.

### Library discovery and coach authoring

Preserve current bounded search, custom metadata, multiple levels, sorting, pinning, vaulting, collections, and bulk assignment.

Basic search stays visible; advanced filters collapse.

One Add Resource flow:

1. Choose from Library or Add new.
2. Set shared-Library inclusion when adding.
3. Set assignment instructions and lesson/student association.
4. Confirm broader sharing where relevant.

Do not physically deduplicate historical files or retire legacy commands in this initiative. Consolidate their UI only after compatibility tests prove historical access and actor-media behavior.

**Classification:** U, N, L. Advanced rehearsal tools and OCR: O.

## 11. Connected lesson, Today, and My Work

### Lesson workspace

Enhance the existing coach and portal hubs.

- **Before:** logistics, focus, recent feedback, assignments, resources, readiness.
- **During:** join, viewer, private note draft, student context.
- **After:** complete, save/publish notes, assign practice/resources, review coverage, compose follow-up.

No mandatory completion wizard. Each action has independent save and authorization.

Today Write note opens the exact lesson draft. Existing drafts are reused; repeated navigation must not create duplicates.

Class lessons preserve whole-session versus individual-participation distinctions.

### Today

Merge useful Coach Home content into Today:

- Current/next lesson and join.
- Day agenda.
- Notes due.
- Requests, approvals, and import review.
- Financial exceptions and communication failures.
- Collapsed week preview.

Each attention item opens its exact target. Keep administrative setup outside the main day workflow.

### My Work and Home

Use shared authoritative summaries that combine legacy script roles and canonical assignments without duplicate cards.

My Work shows active script, resources, instructions, practice, progress, relevant published feedback, and completed/vaulted history.

Home shows the next lesson, current task, recent feedback, requests, and permitted account exceptions. Guardian Home uses the selected authorized student and relevant responsibilities.

**Classification:** U, L, N.

## 12. Explicit studio-operation improvements

| Workflow              | Required change                                                                                                                       | Safeguards and acceptance                                                                       | Class |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----- |
| Scheduling/booking    | Separate Calendar/Bookings/Recurring operations from Services/Availability/Setup configuration; reuse one edit/reschedule interaction | DST, conflict override, cutoff, holds, calendar retry, and recurrence tests                     | U, F  |
| Roster/onboarding     | URL-persisted search/filter/sort; concise invitation/activation statuses; creation followed by a deliberate invitation step           | Import review, duplicate handling, minor requirements, merge history preservation               | U     |
| Finance/invoices      | Liabilities-first hierarchy, package assignment review, explicit checkout-pending recovery, consistent history access                 | Issued snapshots, partial payments, exactly-once fulfillment, no repricing existing agreements  | U, F  |
| Inbox/notifications   | Exact conversation/message links, student/lesson context, understandable delivery and unread states                                   | Existing recipient permissions, approvals, undo/send protections; no new backend                | U     |
| Guardian management   | Authorized student selector, concise responsibility view, contextual permission editor                                                | Access rights remain distinct from payer/scheduling roles; direct-route denial tests            | U, N  |
| Actor Pages           | Identity/media/professional sections, draft preview, review request, reviewed publish/unpublish                                       | Preserve approved media, published revisions, minor protections, and public-state boundaries    | U     |
| Referrals             | Compact share/status/progress view in More/Studio                                                                                     | Preserve reward eligibility and transaction history                                             | U     |
| Campaigns             | Coherent compose → audience → preview → schedule/send review; searchable history and delivery outcomes                                | Explicit confirmation, unsubscribe, recipient deduplication, no address exposure                | U     |
| Settings/integrations | Working URL sections; concise identity, rates, automation, integration, data/recovery summaries                                       | Sensitive operations retain confirmation; health distinguishes configured from verified working | U, F  |
| Public surfaces       | Regression review of login, booking, management tokens, package/gift pages, actors, terms, unsubscribe                                | Preserve URLs, identity matching, checkout safety, token authorization, and consent             | U     |

## 13. File-by-file engineering map

All existing-file links reference the inspected workspace. New files are proposed names; generate migration filenames through the Supabase CLI rather than inventing timestamps.

### Credits and finance

| Existing file                                                                                            | Planned modification                                                                               |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [CreditAccount.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/CreditAccount.tsx)           | Replace live frontend simulation; render backend coverage, reasons, preference, and actual results |
| [finance.ts — commands](C:/Users/dariu/Desktop/studio-portal/netlify/functions/_v2/finance.ts)           | Typed credit operations, atomic grant/assignment RPCs, replay-safe results                         |
| [auto-credits.ts](C:/Users/dariu/Desktop/studio-portal/netlify/functions/_shared/auto-credits.ts)        | Bounded retry processing, accurate counts, failure isolation                                       |
| [booking-maintenance.ts](C:/Users/dariu/Desktop/studio-portal/netlify/functions/booking-maintenance.ts)  | Process coverage jobs and resumable recovery sweep                                                 |
| [provider-intake.ts](C:/Users/dariu/Desktop/studio-portal/netlify/functions/provider-intake.ts)          | Evaluate eligible coverage after approved import creation/update                                   |
| [stripe-webhook-v2.ts](C:/Users/dariu/Desktop/studio-portal/netlify/functions/stripe-webhook-v2.ts)      | Preserve receipt/fulfillment idempotency; atomically record coverage retry intent                  |
| [package-gifts.ts](C:/Users/dariu/Desktop/studio-portal/netlify/functions/package-gifts.ts)              | Consistent post-claim coverage results and recovery intent                                         |
| [studentFinancialSummary.ts](C:/Users/dariu/Desktop/studio-portal/src/domain/studentFinancialSummary.ts) | Shared, currency-aware summary contract; avoid invoice/booking double counting                     |
| [CoachHome.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/CoachHome.tsx)                   | Correct dollar-credit metric; transfer retained content into Today                                 |
| [InvoiceWorkspace.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/finance/InvoiceWorkspace.tsx)   | Secondary placement, exact invoice context, checkout exception presentation                        |

**New:** `src/data/creditCoverage.ts`, shared coverage types, additive credit diagnostics/command/queue migrations.

**Modify through new migrations:** `reserve_student_lesson_credit`, `reserve_student_upcoming_credits`, `set_student_credit_auto`, `set_student_credit_total`, `command_create_lesson`, `command_make_lesson_recurring`, and affected import, grant, fulfillment, and cancellation boundaries. Historical migration files remain untouched.

### Lesson operations and bulk management

| Existing file                                                                                                      | Planned modification                                             |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [lessons.ts — commands](C:/Users/dariu/Desktop/studio-portal/netlify/functions/_v2/lessons.ts)                     | Occurrence-safe changes, bulk preview/execute/retry dispatch     |
| [schemas.ts](C:/Users/dariu/Desktop/studio-portal/netlify/functions/_shared/schemas.ts)                            | Explicit schemas for credit and bulk payloads                    |
| [bookingCommands.ts](C:/Users/dariu/Desktop/studio-portal/src/data/bookingCommands.ts)                             | Typed bulk calls and stable request keys across retries          |
| [StudentWorkspaceLessons.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/StudentWorkspaceLessons.tsx) | Shared selection, exact lesson hub, contextual draft behavior    |
| [StudioLessons.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/StudioLessons.tsx)                     | Reuse common lesson actions; studio batch integration            |
| [LessonCalendar.tsx](C:/Users/dariu/Desktop/studio-portal/src/components/LessonCalendar.tsx)                       | Agenda/list selection and persisted view/filter state            |
| [BookingCenter.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/BookingCenter.tsx)                     | Explicit operational scopes, exact booking/lesson context        |
| [calendar-worker.ts](C:/Users/dariu/Desktop/studio-portal/netlify/functions/calendar-worker.ts)                    | Verify per-occurrence side effects and expose sync outcomes      |
| [booking-email.ts](C:/Users/dariu/Desktop/studio-portal/netlify/functions/_shared/booking-email.ts)                | Preserve reviewed recipient scope and deduplicate queued changes |

**New:** `src/data/lessonBulk.ts`, `src/hooks/useLessonSelection.ts`, shared batch toolbar/review/results components, bulk command module and worker, additive bulk-job and archive/void migrations.

### Student records and navigation

| Existing file                                                                                                        | Planned modification                                                         |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [StudentWorkspace.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/StudentWorkspace.tsx)                 | Header actions, Household route, administration menu, exact editor URL state |
| [StudentWorkspaceOverview.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/StudentWorkspaceOverview.tsx) | Authoritative summary and exact context links                                |
| [StudentWorkspaceAccount.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/StudentWorkspaceAccount.tsx)   | Separate concise Household from access/pricing administration                |
| [StudentWorkspacePayments.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/StudentWorkspacePayments.tsx) | Liabilities/credits summary and progressive disclosure                       |
| [StudentFinancialSetup.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/StudentFinancialSetup.tsx)       | Reuse concise summary; move forecasts/configuration into secondary views     |
| [StudentPortalPayments.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/student/StudentPortalPayments.tsx)     | Same financial hierarchy with role-appropriate actions                       |
| [AppShell.tsx](C:/Users/dariu/Desktop/studio-portal/src/components/AppShell.tsx)                                     | Grouped navigation, real mobile More menu, global search                     |
| [coachNavigation.ts](C:/Users/dariu/Desktop/studio-portal/src/app/coachNavigation.ts)                                | Six primary destinations and Studio grouping                                 |
| [portalNavigation.ts](C:/Users/dariu/Desktop/studio-portal/src/app/portalNavigation.ts)                              | My Work/Messages labels, secondary destinations, permissions                 |
| [App.tsx](C:/Users/dariu/Desktop/studio-portal/src/app/App.tsx)                                                      | Compatibility redirects and new exact detail routes                          |
| [StudentPortal.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/student/StudentPortal.tsx)                     | Selected authorized student context and consistent mobile navigation         |
| [routeDomains.ts](C:/Users/dariu/Desktop/studio-portal/src/features/coach/routeDomains.ts)                           | Reduce broad tab dependencies                                                |
| [useStudio.ts](C:/Users/dariu/Desktop/studio-portal/src/hooks/useStudio.ts)                                          | Targeted invalidation, identity/student query scope, compatibility           |
| [ActivityCenter.tsx](C:/Users/dariu/Desktop/studio-portal/src/components/ActivityCenter.tsx)                         | Exact item routing and context preservation                                  |

**New:** bounded workspace/financial summary reads, `src/data/globalSearch.ts`, search component, record-link resolver, summary/search migrations and types.

### Materials and connected coaching

| Existing file                                                                                                          | Planned modification                                               |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [ResourceBrowser.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/library/ResourceBrowser.tsx)                   | Route-based detail workspace and concise discovery controls        |
| [ResourceEditor.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/library/ResourceEditor.tsx)                     | One Add Resource flow and shared learner instructions              |
| [AssignmentEditor.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/library/AssignmentEditor.tsx)                 | Preserve assignment-specific instructions and associations         |
| [library.ts — data](C:/Users/dariu/Desktop/studio-portal/src/data/library.ts)                                          | Extended detail reads, lesson links, study-state operations        |
| [library.ts — types](C:/Users/dariu/Desktop/studio-portal/src/domain/library.ts)                                       | Viewer metadata, content identity, instruction and study contracts |
| [repository.ts](C:/Users/dariu/Desktop/studio-portal/src/data/repository.ts)                                           | Reuse signed URL access; identity-safe expiry and cache clearing   |
| [StudentWorkspaceWork.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/StudentWorkspaceWork.tsx)           | Unified current work, bounded history, legacy compatibility        |
| [StudentPortalWork.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/student/StudentPortalWork.tsx)               | Unified learner work and real archive pagination                   |
| [StudentPortalWorkContent.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/student/StudentPortalWorkContent.tsx) | Shared assignment/resource actions and progress                    |
| [StudentPortalLessonHub.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/student/StudentPortalLessonHub.tsx)     | Viewer and exact published-feedback context                        |
| [StudentPortalHome.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/student/StudentPortalHome.tsx)               | Authoritative next-action/current-work summary                     |
| [StudioToday.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/StudioToday.tsx)                             | Unified day workspace and exact note/request links                 |

**New:** resource workspace/viewer components, study data module and types, private study-state/annotation migrations. Existing canonical material tables remain authoritative.

### Studio operations and common quality

| Existing file                                                                                              | Planned modification                                              |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [StudentsIndex.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/StudentsIndex.tsx)             | URL filters/sort, onboarding state, bounded roster                |
| [BookingCenter.shared.ts](C:/Users/dariu/Desktop/studio-portal/src/features/coach/BookingCenter.shared.ts) | Operational versus configuration navigation                       |
| [StudioFinance.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/StudioFinance.tsx)             | Consistent liability, package, and exception hierarchy            |
| [Inbox.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/messages/Inbox.tsx)                          | Exact conversation selection and delivery context                 |
| [StudioActorPages.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/StudioActorPages.tsx)       | Reviewed publication and explicit state                           |
| [Referrals.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/referrals/Referrals.tsx)                 | Compact progress and secondary placement                          |
| [Campaigns.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/Campaigns.tsx)                     | Shared review/schedule/history interactions                       |
| [StudioSettings.tsx](C:/Users/dariu/Desktop/studio-portal/src/features/coach/StudioSettings.tsx)           | All-panel deep links and grouped configuration                    |
| [Primitives.tsx](C:/Users/dariu/Desktop/studio-portal/src/components/Primitives.tsx)                       | Shared action, disclosure, dialog, and selection behavior         |
| [WritingArea.tsx](C:/Users/dariu/Desktop/studio-portal/src/components/WritingArea.tsx)                     | Preserve usable long-form editing and accessible save states      |
| [database.generated.ts](C:/Users/dariu/Desktop/studio-portal/src/types/database.generated.ts)              | Regenerate from the isolated migration stack                      |
| [playwright.config.ts](C:/Users/dariu/Desktop/studio-portal/playwright.config.ts)                          | Add tablet coverage and targeted cross-browser journeys           |
| [netlify.toml](C:/Users/dariu/Desktop/studio-portal/netlify.toml)                                          | Viewer CSP/worker compatibility only where necessary              |
| [package.json](C:/Users/dariu/Desktop/studio-portal/package.json)                                          | Pinned PDF viewer dependency and applicable verification commands |

Style edits belong in existing component styles and shared tokens. Consolidate duplicated rules incrementally; do not rewrite all stylesheets in one PR.

## 14. Dependency-aware PR roadmap

These are **sequence identifiers**, not predictions of GitHub PR numbers. Each PR includes implementation, relevant tests, evidence, and updated rollout notes.

| Wave / PR | Reviewable scope                                                                                    | Dependencies | Classification |
| --------- | --------------------------------------------------------------------------------------------------- | ------------ | -------------- |
| 1.1       | Credit eligibility evaluator, authorized diagnostics, typed contracts, database regression baseline | Current main | F, R, N        |
| 1.2       | Credit event consistency, accurate counts, atomic grants, retry queue and worker isolation          | 1.1          | F              |
| 1.3       | Occurrence-safe cancellation/rescheduling and shared-booking protections                            | 1.1          | F              |
| 1.4       | Bulk eligibility, frozen preview, transactional execution, archive/void metadata                    | 1.3          | N              |
| 1.5       | Shared lesson selection/review/results UI across all required list surfaces                         | 1.4          | N, U           |
| 1.6       | Student Overview, Household, Payments, credit coverage UI, financial-label and immediate-link fixes | 1.1–1.2      | F, U, L        |
| 2.1       | Shared record links, URL context, dialog/history/action foundations                                 | Wave 1       | U              |
| 2.2       | Coach/student/guardian navigation and Home→Today compatibility                                      | 2.1          | U, L           |
| 2.3       | Permission-aware global record search                                                               | 2.1          | N              |
| 3.1       | Resource detail routes, extended canonical detail, secure viewers                                   | 2.1          | U, N           |
| 3.2       | Private reading position, bookmarks, and study notes                                                | 3.1          | N              |
| 3.3       | Library discovery/authoring refinement and legacy interface consolidation                           | 3.1          | U, L           |
| 4.1       | Unified coach/portal lesson workspace and exact draft/published-note behavior                       | 2.1, 3.1     | U, N           |
| 4.2       | Shared Current Work and student/guardian Home summaries                                             | 3.3, 4.1     | U, L           |
| 4.3       | Unified Today, approvals, follow-up, and readiness context                                          | 2.2, 4.1–4.2 | U, L           |
| 5.1       | Scheduling, recurrence operations, and roster/onboarding                                            | Waves 1–2    | U, F           |
| 5.2       | Studio finance, invoices, package/renewal exception handling                                        | Wave 1       | U              |
| 5.3       | Inbox, notification continuity, and guardian management completion                                  | Waves 2, 4   | U              |
| 5.4       | Actor Page review/publication and referral simplification                                           | Waves 2–3    | U              |
| 5.5       | Campaign composition/history and Settings/integration organization                                  | Wave 2       | U, F           |
| 6.1       | Full cross-role task acceptance, accessibility, responsive/performance repairs                      | Waves 1–5    | U, verified F  |
| 6.2       | Final compatibility/security audit, release evidence, approved-release runbook                      | 6.1          | Validation     |

Use branches prefixed `codex/`. Start each independent PR from current approved `main`; use short dependency chains only when required. Recheck migrations and head before beginning each wave.

## 15. Tests and acceptance criteria

### Wave 1 — Reliability and immediate usability

**Credit scenarios**

- Add credits with upcoming unpaid lessons.
- Enable/disable automatic use.
- Assign, purchase, renew, or claim a package.
- Create a lesson, create a recurring series, convert an existing lesson.
- Reschedule within validity, into eligibility, and beyond package expiry.
- Cancel with return or retention; complete without a second debit.
- Expired lots, limited credits, equal dates, zero eligible lessons.
- Paid, partially paid, waived, refunded, invoice-linked, and processing lessons.
- Mixed preferences and inconsistent legacy ledgers.
- Group participation and unrelated-student protection.
- Duplicate requests, worker repeats, interrupted runs, and concurrent commands.
- Correct account totals, lesson coverage, booking state, invoice state, and audit evidence after every operation.

Add full PostgreSQL/pgTAP lifecycle tests using the complete migration chain. Use separate PostgreSQL sessions for concurrency; PGlite alone cannot prove locking behavior.

**Bulk scenarios**

- Visible-page selection and all-matching frozen scope.
- Pagination, exclusions, filtering, and refreshed results.
- Eligible deletion physically removes the intended lesson.
- Every dependency category blocks deletion, including JSON/array references.
- Selected occurrences leave unrelated series occurrences untouched.
- Shared bookings remain active when unaffected occurrences remain.
- New dependencies or stale versions after preview cause safe skips.
- Duplicate submission, worker crash/restart, partial failures, and retry.
- Archive restores; void retains history; cancellation preserves notes/materials.
- Calendar and notifications target only reviewed records.
- Audit remains after physical deletion.

**Usability acceptance**

- Coach can verify coverage and skipped reasons from one view.
- Household defaults show contacts and responsibilities without all permissions.
- Payments distinguishes due money, dollar credit, and lesson credits.
- Today opens the exact note editor.
- All required batch surfaces use the same review workflow.

### Wave 2 — Navigation and interaction foundations

- Every existing feature remains reachable.
- `/coach` and legacy portal routes preserve useful context.
- Browser Back closes details or restores the originating list.
- Roster/list filters survive record navigation.
- Search opens exact records.
- Search snippets, counts, and action suggestions respect authorization.
- Direct forged routes and unauthorized identifiers disclose no records.

### Wave 3 — Materials

- Open assigned PDF, text, image, audio, and video inside the portal.
- View assignment instructions and return to the associated lesson.
- Refresh expired signed URLs without publicizing files.
- Handle missing, unsupported, image-only, and permission-revoked resources.
- Resume reading, save bookmarks, and save private notes.
- Verify private annotations cannot be read by coaches, guardians, or peers.
- Preserve legacy scripts, actor media, collections, and existing assignment status.
- Reassignment uses the canonical file without another upload.

### Wave 4 — Coaching continuity

- Prepare → join → write draft → complete → publish feedback → assign practice/resources.
- Each operation saves independently.
- Unpublished notes remain private.
- Home, My Work, student Overview, and Today agree on current work.
- Extensive history remains accessible through bounded lists.
- Guardian selected-student context never crosses permissions.

### Wave 5 — Studio operations

- Booking create/edit/reschedule/cancel and recurrence work across DST.
- Onboarding handles minors, duplicates, imports, invitation failure, and activation.
- Invoice drafts, issuance, partial settlement, credits, package fulfillment, and pending checkout recovery retain financial invariants.
- Messages and campaigns preserve recipient privacy, approval, unsubscribe, and delivery protection.
- Actor preview/review/publication retain eligible-media and revision rules.
- Referrals preserve reward behavior.
- All Settings panels support direct links and safe saved/error states.

### Wave 6 — Product-wide quality

Review at 320, 390, 768, and 1440 px, plus 200% zoom. Cover desktop Chromium, mobile Chromium, and critical viewer/navigation flows in WebKit.

Require:

- No page-level horizontal overflow.
- Critical actions unobscured by mobile navigation.
- Visible focus, trapped dialog focus, Escape, and focus restoration.
- Accessible labels, status announcements, contrast, and keyboard selection.
- Zero serious/critical axe findings in required journeys; manually review remaining accessibility requirements.
- No regression in existing JS/CSS shell budgets.
- Bounded list/search responses and lazy viewer loading.
- Large-fixture tests for extensive lessons, multiple packages, guardians, and mixed legacy/canonical work.

Preserve existing 130 KB JS and 25 KB CSS gzip failure budgets for ordinary app assets. Introduce separately identified lazy PDF renderer/worker budgets, capped initially at 250 KB and 500 KB gzip respectively; they must not load on non-viewer routes.

### Evidence for every PR

Record commit, environment, fixture profile, executed tests, passed/failed/blocked results, completed browser tasks, reviewed viewports, accessibility findings, and remaining limits.

Required checks follow repository CI: lint, format, typecheck, unit/integration tests, build, bundle/secret checks, migration replay/lint/types, pgTAP, and relevant authenticated browser journeys.

Provider-dependent scenarios remain explicitly blocked until isolated test credentials are available.

## 16. Risk assessment and release controls

| Risk                                       | Required mitigation                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Double credit use or incorrect totals      | Shared SQL eligibility; deterministic locks; append-only ledger; transactional counts; concurrent-session tests |
| Changed historical payment meaning         | Preserve snapshots and policies; compare invoice/booking/ledger invariants; no cosmetic netting                 |
| Partial financial command then retry       | Transactional grant/audit/idempotency result; stable replay key                                                 |
| Cancellation affects other occurrences     | Occurrence-specific commands and shared-booking tests before bulk UI                                            |
| Cascading deletion of coaching history     | Strict dependency rejection; explicit scaffolding removal; immutable deletion audit                             |
| Orphan external calendar events            | Reject physical deletion after any projection attempt; use cancellation and confirmed sync                      |
| Bulk timeout or partial failure            | Frozen review snapshot, bounded worker chunks, per-item transactions and resumable results                      |
| Search or summary data leakage             | Invoker reads, existing permission predicates, private-note exclusion, negative-role tests                      |
| Guardian context mismatch                  | Authorized student selector and identity/student-scoped queries                                                 |
| Viewer exposes private files               | Existing private bucket, short-lived URLs, safe MIME handling, identity-aware cache clearing                    |
| Study notes exposed through service access | Owner-only policies and explicit user validation; no coach/guardian listing endpoint                            |
| Legacy material accessibility lost         | Preserve IDs, commands, files, actor links, and compatibility tests before UI consolidation                     |
| Navigation breaks external links           | Route compatibility tests and exact-record resolver                                                             |
| Performance worsens                        | Bounded reads, targeted invalidation, lazy loading, unchanged shell budgets                                     |
| Release targets wrong environment          | Explicit site/project IDs and context assertions; never rely on local linking alone                             |

### Rollout

- Apply new migrations only to isolated test environments during implementation.
- Generate types from the verified isolated stack.
- Use additive migrations and retain old interfaces during transition.
- Production activation requires a concrete reviewed release package and explicit authorization.
- Confirm production and staging IDs before migration or deploy.
- Identify Netlify automatic publication consequences before an authorized merge.
- Roll back application behavior by reverting the individual PR or disabling its feature; retain additive schema and financial audit history.
- Never run destructive rollback SQL against financial records.
- Monitor coverage-job failures, reservation conflicts, bulk failures, calendar lag, denied search reads, and viewer errors without logging private note bodies or signed URLs.

## 17. Requirements, assumptions, and deferred enhancements

### Fixed requirements

The complete six-wave initiative remains required. It includes real eligible-record bulk deletion, authoritative automatic-credit explanations, Household/payment simplification, record search, secure viewing, basic study tools, connected lesson workflows, and all named studio operations.

### Recommended defaults

- Preserve the existing application and integration stack.
- Keep current URLs wherever possible.
- Use explicit save for authored notes; automatic save only for reading/playback position.
- Preserve existing notification behavior unless a separately reviewed change is approved.
- Keep mixed automatic-credit settings unresolved until coach review.
- Do not add financial policy restrictions by service or duration.
- Do not remove historical data or physically consolidate files.
- Treat staging environment availability as a verification dependency, not a reason to use production fixtures.

### Optional future enhancements

- OCR for image-only PDFs.
- Beats, objectives, tactics, obstacles, and rehearsal modes.
- Offline resource storage.
- Expanded draft autosave.
- Historical physical file deduplication.
- Broad dependency or provider API upgrades unrelated to modernization.

These are **O** and do not block completion of the requested modernization.

## 18. Recommended first PR and approval points

**PR 1: Authoritative lesson-credit diagnostics and lifecycle regression foundation.**

Include:

- A shared SQL eligibility evaluator that preserves current financial policy.
- Authorized, bounded coverage and preview reads.
- Typed reason codes and result contracts.
- Tests for existing reservations, expiry, cash/partial payment, checkout locks, disabled/mixed preferences, legacy review, group ownership, and zero eligible lessons.
- Characterization tests exposing recurring-conversion and newly-applied-count gaps.
- Full-schema PostgreSQL tests alongside existing PGlite coverage.
- A documented event-path matrix and verification limits.

Exclude bulk UI, navigation restructuring, production balance changes, reconciliation, and production migration application from this first PR.

The recommended sequence is **credit truth → credit reliability → occurrence safety → bulk backend/UI → student simplification**, followed by navigation, Materials, coaching continuity, studio operations, and final acceptance.

No further product decision is needed to begin that scoped implementation. Later explicit approvals are required for production migrations/publication, merges with publication consequences, live financial adjustments or reconciliation, destructive live operations, and changes to outbound communication behavior.

The next implementation session should first save this document under the specified `docs/` path, then begin PR 1. Implementation should stop at reviewable delivery until release authorization is granted.
