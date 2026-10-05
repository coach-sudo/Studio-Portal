# Redesign verification — October 5, 2026

Branch: `codex/product-design-modernization`. Implementation started at
`bf22833`, with PR #26 operational intelligence already present. PR #26 is now
merged. The review branch is based on current main, including PR #27's fixture
safety correction. The redesign changes no server, schema, provider, payment,
authorization, recipient, or automation logic.

## Results

| Check                      | Result                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vitest                     | 78 files, 439 tests passed (`npm run test -- --maxWorkers=4`)                                                                                                                                                |
| TypeScript                 | Passed, including production build                                                                                                                                                                           |
| ESLint                     | 0 errors; pre-existing migration warnings and label-style warnings remain                                                                                                                                    |
| Prettier                   | Passed                                                                                                                                                                                                       |
| Production build           | Passed                                                                                                                                                                                                       |
| Bundle budget              | Passed; entry JS 94,789 bytes gzip / 130,000 limit; main CSS 24,967 / 25,000 limit. CSS remains above the 22,000 warning threshold. No budget changed.                                                       |
| Secret scan                | Passed                                                                                                                                                                                                       |
| Dependency audit           | High-severity gate passed; existing DOMPurify 3.4.15 has one low-severity advisory, GHSA-p98j-92pf-mc4p. Dependency updates are outside this visual PR.                                                      |
| Local Playwright           | 74 desktop/mobile checks, 0 horizontal overflow, 0 runtime errors                                                                                                                                            |
| axe WCAG 2 A / AA          | 0 serious or critical findings across the captured local fixture states                                                                                                                                      |
| Keyboard                   | Side sheet contains focus through 65 Tab presses at each viewport; Escape closes it. Unit tests verify reverse wrapping, hidden/disabled exclusion, focus return, unique naming and nested overlay handling. |
| Fixtures                   | Local demo contexts only, fixed browser date/time and isolated storage; no provider credentials, fixture API writes, mail or charges. Context disposal cleans local browser data.                            |
| Supabase                   | Not run: no database or authorization changes. Existing permission/RLS tests preserved.                                                                                                                      |
| Deployed provider journeys | Not run locally; existing isolated staging suites remain required before release. Live Stripe/Google coverage is not represented by demo screenshots.                                                        |

The unconstrained Windows Vitest run intermittently exceeded an existing 1-second
lazy-route test timeout. Limiting worker contention made all existing assertions
pass. No timeout or assertion was weakened.

## Route and screenshot coverage

Every row below has desktop (1440 × 1000) and mobile (390 × 844) screenshots.
Output is `test-results/redesign/`; filenames use `<name>-<desktop|mobile>.png`.
The machine-readable results are `test-results/redesign/verification.json`.

| Screen                 | Screenshot name      | Presentation                                                                   |
| ---------------------- | -------------------- | ------------------------------------------------------------------------------ |
| Coach Home             | coach-home           | Open introduction, operational summary, quiet metrics, week and follow-up rail |
| Today                  | today                | Lesson timeline, featured next lesson, preserved readiness and preparation     |
| Students               | students             | Refined searchable roster, status filters and touch targets                    |
| Student workspace      | student-detail       | Profile, local navigation, current work and account context                    |
| Coach lesson           | coach-lesson         | Teaching panels and operational detail                                         |
| Bookings calendar      | calendar             | Schedule with semantic appointment states                                      |
| Service catalog        | services             | Service cards and consistent actions                                           |
| Service edit           | service-drawer       | Right-side sheet, grouped settings, accessible keyboard and sticky actions     |
| Availability           | availability         | Weekly hours and exception surfaces                                            |
| Coach payments         | payments             | Financial grouping and consistent package controls                             |
| Coach Inbox            | coach-inbox          | Split conversation view, message bubbles and composer                          |
| Settings               | settings             | Quiet category index and modern forms                                          |
| Automations            | automation           | Rule cards; shared rule editor is a side sheet                                 |
| Materials              | materials            | Teaching library and consistent resource surfaces                              |
| Actor management       | actor-admin          | Publishing states and modern shared surfaces                                   |
| Campaigns              | campaigns            | Editorial workspace and shared controls                                        |
| Coach referrals        | coach-referrals      | Consistent share actions                                                       |
| Student Home           | student-home         | Next lesson and package summary, work below, contact actions secondary         |
| Student work           | student-work         | Readable practice and script content                                           |
| Student schedule       | student-schedule     | Mobile agenda and booking actions                                              |
| Student lesson         | student-lesson       | Preparation and readable teaching content                                      |
| Student payments       | student-payments     | Clear balance status, packages and receipts                                    |
| Student settings       | student-settings     | Modern forms and appearance preferences                                        |
| Student Inbox          | student-inbox        | Conversations and composer                                                     |
| Student actor          | student-actor        | Preview and side sheet editor                                                  |
| Student referrals      | student-referrals    | Consistent sharing experience                                                  |
| Guardian Home          | guardian-home        | Explicit household context; demo guardian role fixture                         |
| Public booking catalog | public-booking       | Premium service selection and warm white surfaces                              |
| Public booking flow    | booking-flow         | Guided steps and readable summary                                              |
| Booking success        | booking-confirmation | Actual simulated booking flow completion                                       |
| Public actor           | public-actor         | Portfolio presentation retains independent identity                            |
| Login                  | login                | Focused white authentication surface                                           |
| Terms                  | terms                | Readable public document                                                       |
| Dark appearance        | portal-dark          | Theme-aware surfaces, navigation, inputs and semantic colors                   |
| Empty                  | empty                | Useful empty state                                                             |
| Skeleton               | skeleton             | Structural placeholder with accessible status                                  |
| Dialog / error         | form-error           | Short confirmation dialog, inline validation and action hierarchy              |

To reproduce, run `npm run dev -- --host 127.0.0.1 --port 5173` without Supabase
credentials, then `node scripts/review-product-design.mjs`. The extra fixture
entry rejects production mode, configured clients and non-loopback hosts; it is
not included in the production build.

## Remaining verification and visual debt

- Token-scoped booking management, gift/package checkout, credential callback and class variants inherit the shared system but do not yet have new local visual evidence. Validate these using the existing isolated deployed fixtures.
- Real payment methods, failure/suppression/provider states and guardian authorization require staging coverage; this PR does not claim those were exercised live.
- Legacy feature CSS remains where required for existing states. Superseded hero and foundation rules were removed; a wholesale deletion of the old stylesheet was intentionally avoided.
- Further per-feature information-architecture changes, including moving the calendar's lesson interactions into a contextual booking drawer, are deferred. Existing calendar behavior and deep links remain intact.

No production deployment, publication, migration, environment change, email,
charge, DNS change, or production data mutation occurred.
