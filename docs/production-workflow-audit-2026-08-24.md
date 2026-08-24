# Production workflow audit — 2026-08-24

All checks below were run against `https://portal.d-a-j.com` after the database migrations and production deploy, except the explicitly marked component checks, which run in the production build test harness. Existing client data was not rewritten or deleted. Mutating checks used the clearly labeled Production Test Student record.

## Coach workflows (1–25)

| # | Workflow | Result |
|---:|---|---|
| 1 | Open coach home | Pass |
| 2 | Open Today and the 48-hour notes queue | Pass |
| 3 | Open Bookings overview | Pass |
| 4 | Open booking calendar tab | Pass |
| 5 | Open service administration | Pass |
| 6 | Open availability administration | Pass |
| 7 | Open classes and courses | Pass |
| 8 | Open recurring-series administration | Pass |
| 9 | Open the student roster | Pass |
| 10 | Open a complete student record | Pass |
| 11 | Open Edit student details | Pass |
| 12 | Open Add lesson | Pass |
| 13 | Open student lesson history | Pass |
| 14 | Open student practice and materials | Pass |
| 15 | Open student notes | Pass |
| 16 | Open student access/account controls | Pass |
| 17 | Open student payments | Pass |
| 18 | Open student actor-page controls | Pass |
| 19 | Open studio-wide lessons | Pass |
| 20 | Open studio-wide notes | Pass |
| 21 | Open the material library | Pass |
| 22 | Open finance and balances | Pass |
| 23 | Open actor publishing | Pass |
| 24 | Open all six Settings panels | Pass |
| 25 | Use the complete mobile More menu | Pass |

## Current-student workflows (26–40)

| # | Workflow | Result |
|---:|---|---|
| 26 | Sign in with the Production Test Student username/password | Pass — live Auth |
| 27 | Receive `/portal` as the login destination | Pass — live Auth |
| 28 | Read only the signed-in student’s record | Pass — RLS returned one student |
| 29 | Read and display the preferred name | Pass — `Test Student` |
| 30 | Confirm portal access is enabled | Pass |
| 31 | Read the student’s lesson scope | Pass — two lessons |
| 32 | Read published note scope | Pass — four notes |
| 33 | Read practice scope | Pass — one assignment |
| 34 | Read the lesson-conversation scope | Pass |
| 35 | Deny anonymous lesson-message writes | Pass — 401/403 |
| 36 | Open the canonical portal home | Pass — component workflow |
| 37 | Open student bookings and policy controls | Pass — component workflow |
| 38 | Open searchable, paginated student notes | Pass — component workflow |
| 39 | Complete practice and request coach help | Pass — component workflow |
| 40 | Open materials, settings, payments, and actor editor | Pass — component workflows |

## Interested-student booking workflows (41–50)

| # | Workflow | Result |
|---:|---|---|
| 41 | Open `/book` while the coach is signed in | Pass |
| 42 | Load configured studio name, logo, colors, copy, and footer | Pass |
| 43 | Follow the single student/guardian sign-in route | Pass — `/login` |
| 44 | Load three published services and current prices | Pass |
| 45 | Open a service detail and meeting-format step | Pass |
| 46 | Display the current 36-hour policy before booking | Pass |
| 47 | Select Google Meet or in-person delivery | Pass |
| 48 | Query live Google-filtered availability | Pass |
| 49 | Choose a day and then a time in the 45-day calendar | Pass |
| 50 | Open Terms and the configured external website footer link | Pass |

## Automated regression result

`npm test -- --run`: 107/107 passed across 12 test files. The workflow suites now contain the original 30 start-to-finish scenarios plus 20 production-completeness routes, alongside booking, provider, data, and policy tests.

`npm run typecheck`: passed.

`npm run build`: passed.

## Preserved legacy data

- All 12 existing notes are already linked to lessons.
- Three existing assignments and five existing material links predate lesson linking. They remain visible in their general libraries and were not auto-attached to guessed lessons.
- Existing booking policy snapshots were preserved. The 36-hour rule applies to all four current service definitions and future bookings.
