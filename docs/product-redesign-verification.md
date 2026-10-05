# Redesign verification — October 5, 2026

Branch: `codex/product-design-modernization`. Implementation started at
`bf22833`, with PR #26 operational intelligence already present. PR #26 is now
merged. The review branch is based on current main, including PR #27's fixture
safety correction. The initial redesign changed presentation only; the later
coach-approved payment-reminder work is recorded in the follow-up section below.
Schema, booking policy, financial ledgers and recipient authorization are unchanged.
The focused corrections follow
reviewed head `132a3d83a1fd5ca06877da668877f23cbe9cf7b8`.

## Results

| Check                  | Result                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitest                 | 79 files, 447 tests passed (`npm run test -- --maxWorkers=4`); eight calendar-specific tests cover booking selection, both deep links, unbooked lessons, selected recurring occurrences, and group participant choices/focus return.                                                                                                     |
| TypeScript             | Passed, including production build                                                                                                                                                                                                                                                                                                       |
| ESLint                 | 0 errors; pre-existing migration warnings and label-style warnings remain                                                                                                                                                                                                                                                                |
| Prettier               | Passed                                                                                                                                                                                                                                                                                                                                   |
| Production build       | Passed                                                                                                                                                                                                                                                                                                                                   |
| Bundle budget          | Passed; entry JS approximately 94.8 KB gzip / 130,000 limit; main CSS 22,739 / 25,000 limit (before 24,967). CSS remains above the unchanged 22,000 warning threshold. Hard-budget headroom is 2,261 bytes.                                                                                                                              |
| Secret scan            | Passed                                                                                                                                                                                                                                                                                                                                   |
| Dependency audit       | High-severity gate passed; existing DOMPurify 3.4.15 has one low-severity advisory, GHSA-p98j-92pf-mc4p. Dependency updates are outside this visual PR.                                                                                                                                                                                  |
| Local Playwright       | 90 desktop/mobile checks, 0 horizontal overflow, 0 runtime errors; appointment booking and unbooked lesson drawers now included.                                                                                                                                                                                                         |
| axe WCAG 2 A / AA      | 0 serious or critical findings across the captured local fixture states                                                                                                                                                                                                                                                                  |
| Keyboard               | Calendar appointment selection by Enter; booking drawer retains focus through 30 Tab and 30 Shift+Tab presses per viewport; Escape closes and returns focus to the appointment. Existing service sheet retains its 65-Tab check. Unit tests cover group sheet replacement, hidden/disabled exclusion, unique naming and nested overlays. |
| Fixtures               | Local demo contexts only, fixed browser date/time and isolated storage; no provider credentials, fixture API writes, mail or charges. Context disposal cleans local browser data.                                                                                                                                                        |
| Supabase               | No migration, generated database type, RLS, or migration workflow changes. Existing reset/lint/pgTAP/type-drift checks remain required on the corrected head; exact final CI evidence is recorded on PR #28.                                                                                                                             |
| Deployed browser suite | Initial redesign head: 42 passed, 1 explicitly BLOCKED (Stripe test key unavailable); 4 deployed health checks passed. Fixture cleanup restored public, storage, auth users and identities to baseline, with 0 remaining E2E users.                                                                                                      |

## Focused corrections and CSS evidence

The Calendar tab delegates appointment inspection to Bookings. A real participant
relationship opens that booking, with the selected occurrence's time and lesson
link. The existing unique student/time reconciliation is the fallback. Multiple
participant bookings are offered explicitly; no arbitrary booking is chosen.
Lessons without a relationship open a lesson-detail drawer with existing routes.
Both `?booking=...` and `?lesson=...` work; Done/Escape dismiss and remove only
those query parameters. Existing command payloads, booking policy, payment,
calendar sync, authorization and recipients are unchanged.

Existing readiness supplies preparation, financial/package coverage, confirmation,
reminder and calendar/meeting context where the lesson has the matching student.
Message links appear only for an existing direct conversation. The location field
uses existing form primitives, and the mobile booking footer uses two columns
with a full-width Done action. The existing invalid booking-summary definition
list was corrected without changing the commands.

Live query snapshots can change identity on every render. Deep links are opened
once per requested booking/lesson pair, so snapshot updates cannot reopen a
dismissed drawer during navigation. Two regression tests exercise fresh snapshots
on every render for both deep-link forms.

CSS gzip: **24,967 → 22,739 bytes**, a **2,228-byte reduction** and **2,261-byte
margin** below the unchanged 25,000-byte hard budget. The 22,000-byte warning is
still active. Safely reaching that warning would require a broader feature-state
audit, so the remaining compatibility rules are retained.

The cleanup removed 420 declarations proven to be overridden by later declarations
for the same selector/property (including fully covering shorthands), with matching
conditional scope or a later unconditional owner in `main.tsx` import order.
Importance and same-rule value fallbacks were preserved; keyframes and layers
were excluded. Another 82 obsolete selectors were removed only after checking
their positive classes against all application TS/TSX producers. Native dialog
backdrop styling was obsolete because the shared Dialog renders a section.
Rare, error, permission, theme and provider-state rules were retained.

The CSS-only comparison found **0 computed-style differences across 44
desktop/mobile states**, before the intentional appointment field/footer changes.
Removal proofs and comparison data are retained in
`test-results/redesign/css-{consolidation,shorthand-consolidation,obsolete-selectors}.json`
and `css-computed-differences.json`. A namespaced lesson/participant fixture now
links to an existing isolated booking for deployed drawer tests; it queues no
provider work or mail and cleanup explicitly deletes both records.

The unconstrained Windows Vitest run intermittently exceeded an existing 1-second
lazy-route test timeout. Limiting worker contention made all existing assertions
pass. No timeout or assertion was weakened.

The final visual review also found that the portal Home link's trailing slash
prevented its active state at `/portal`. Desktop and mobile navigation now use
the canonical root path; the existing route test verifies `aria-current` and the
active class for both Home links.

GitHub run `37347779465` passed after a retry of the ephemeral runner's database
port conflict. The first attempt stopped before browser tests. The retry exercised
the existing desktop, mobile, guardian/permission and accessibility suites.
Journey 08 retains its explicit Stripe test-key block; no live checkout was used.
CI evidence is retained locally in `test-results/redesign/ci-initial/`.

## Route and screenshot coverage

Every row below has desktop (1440 × 1000) and mobile (390 × 844) screenshots.
Output is `test-results/redesign/`; filenames use `<name>-<desktop|mobile>.png`.
The machine-readable results are `test-results/redesign/verification.json`.

| Screen                  | Screenshot name      | Presentation                                                                                 |
| ----------------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| Coach Home              | coach-home           | Open introduction, operational summary, quiet metrics, week and follow-up rail               |
| Today                   | today                | Lesson timeline, featured next lesson, preserved readiness and preparation                   |
| Students                | students             | Refined searchable roster, status filters and touch targets                                  |
| Student workspace       | student-detail       | Profile, local navigation, current work and account context                                  |
| Coach lesson            | coach-lesson         | Teaching panels and operational detail                                                       |
| Bookings calendar       | calendar             | Schedule with semantic appointment states                                                    |
| Calendar booking drawer | calendar-drawer      | Appointment selected by keyboard; contextual booking and readiness; full-screen mobile sheet |
| Unbooked lesson drawer  | calendar-lesson      | Honest lesson detail with existing routes and no fabricated booking actions                  |
| Service catalog         | services             | Service cards and consistent actions                                                         |
| Service edit            | service-drawer       | Right-side sheet, grouped settings, accessible keyboard and scrollable actions               |
| Availability            | availability         | Weekly hours and exception surfaces                                                          |
| Coach payments          | payments             | Financial grouping and consistent package controls                                           |
| Coach Inbox             | coach-inbox          | Split conversation view, message bubbles and composer                                        |
| Settings                | settings             | Quiet category index and modern forms                                                        |
| Automations             | automation           | Rule cards; shared rule editor is a side sheet                                               |
| Materials               | materials            | Teaching library and consistent resource surfaces                                            |
| Actor management        | actor-admin          | Publishing states and modern shared surfaces                                                 |
| Campaigns               | campaigns            | Editorial workspace and shared controls                                                      |
| Coach referrals         | coach-referrals      | Consistent share actions                                                                     |
| Coach class             | coach-class          | Class summary, assignments, participants and conversation                                    |
| Student Home            | student-home         | Next lesson and package summary, work below, contact actions secondary                       |
| Student work            | student-work         | Readable practice and script content                                                         |
| Student schedule        | student-schedule     | Mobile agenda and booking actions                                                            |
| Student lesson          | student-lesson       | Preparation and readable teaching content                                                    |
| Student payments        | student-payments     | Clear balance status, packages and receipts                                                  |
| Student settings        | student-settings     | Modern forms and appearance preferences                                                      |
| Student Inbox           | student-inbox        | Conversations and composer                                                                   |
| Student actor           | student-actor        | Preview and side sheet editor                                                                |
| Student referrals       | student-referrals    | Consistent sharing experience                                                                |
| Guardian Home           | guardian-home        | Explicit household context; demo guardian role fixture                                       |
| Public booking catalog  | public-booking       | Premium service selection and warm white surfaces                                            |
| Public booking flow     | booking-flow         | Guided steps and readable summary                                                            |
| Booking success         | booking-confirmation | Actual simulated booking flow completion                                                     |
| Booking management      | booking-management   | Token-scoped demo booking and existing cancel/reschedule actions                             |
| Public package          | public-package       | Isolated catalog fixture; readable benefits, price and purchase paths                        |
| Gift purchase           | gift-purchase        | Isolated catalog fixture; grouped form and one-time-payment notice                           |
| Gift claim              | gift-claim           | Claim form presentation; no claim is submitted                                               |
| Gift confirmation       | gift-confirmation    | Confirmation route presentation; no checkout is submitted                                    |
| Public actor            | public-actor         | Portfolio presentation retains independent identity                                          |
| Login                   | login                | Focused white authentication surface                                                         |
| Terms                   | terms                | Readable public document                                                                     |
| Dark appearance         | portal-dark          | Theme-aware surfaces, navigation, inputs and semantic colors                                 |
| Empty                   | empty                | Useful empty state                                                                           |
| Skeleton                | skeleton             | Structural placeholder with accessible status                                                |
| Dialog / error          | form-error           | Short confirmation dialog, inline validation and action hierarchy                            |

To reproduce, run `npm run dev -- --host 127.0.0.1 --port 5173` without Supabase
credentials, then `node scripts/review-product-design.mjs`. The extra fixture
entry rejects production mode, configured clients and non-loopback hosts; it is
not included in the production build.

Package and gift catalog screenshots intercept only the loopback catalog GET
with deterministic demo values. They validate presentation, not API availability
or checkout behavior. The expanded review corrected gift-label contrast and
kept the checkout action below the full-width payment notice.

## Remaining verification and visual debt

- Credential callbacks and student class variants inherit the shared system but do not yet have new local visual evidence. Validate those credential-dependent states using isolated deployed fixtures.
- Real payment-method/checkout and provider-specific failure states remain outside local visual evidence. Guardian/permission and failure/suppression checks passed in the isolated CI suite; this PR does not claim live provider coverage.
- Legacy feature CSS remains where required for existing states. Superseded hero and foundation rules were removed; a wholesale deletion of the old stylesheet was intentionally avoided.
- Further per-feature information-architecture changes remain outside these focused corrections. Calendar appointment inspection is implemented and included in desktop/mobile screenshot and keyboard coverage.

No production deployment, publication, migration, environment change, email,
charge, DNS change, or production data mutation occurred.
