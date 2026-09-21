# PR3 deployed Playwright and accessibility verification

## Scope and safety

PR3 is stacked on `codex/pr2-query-layer`. It does not merge PR1/PR2, deploy production, enable the query-layer flag in production, or use production Supabase, Stripe, Netlify, or student data.

The fixture endpoint refuses Netlify's `production` context, requires a timing-safe token comparison, and accepts only bounded `e2e-` run IDs. Service-role credentials stay inside Netlify Functions and GitHub Actions and are never returned to browser code, reports, or artifacts.

## Free staging implementation

The Coach Darius Supabase organization already contains its maximum two free-plan projects. Creating the approved dedicated project therefore could not complete at `$0/month`. No upgrade, paid compute, branching, backup, domain, or add-on was accepted.

PR3 uses the free fallback for stacked-branch verification:

1. GitHub's hosted runner starts the repository's Supabase stack in ephemeral Docker containers.
2. The workflow applies every migration, runs database lint and pgTAP/RLS tests, and confirms generated database types.
3. It builds the candidate and starts Netlify Dev in offline mode against that isolated database.
4. Playwright tests the resulting non-production URL with staging-only secrets.
5. Teardown removes the fixture namespace, verifies exact database/Auth/Storage baselines, and stops all containers.

The database and preview exist only for that workflow run. This costs `$0/month`, requires no standing project, and leaves both the production project and the unrelated existing free project untouched. A future externally hosted staging site may replace this fallback only after its quoted cost is confirmed as `$0/month`.

## Fixture lifecycle

`e2e/global.setup.ts` sends a namespaced run ID to `POST /api/e2e/fixtures`. The preview-only function:

1. Resolves the isolated staging studio.
2. Idempotently removes records for the same deterministic run.
3. Creates five ephemeral Auth users and portal accounts: coach, student, guardian, unrelated student, and a sign-out-only student. The dedicated sign-out account prevents a global Supabase sign-out from invalidating the shared student fixture.
4. Creates deterministic lesson, booking service, package/payment, assignment/material, inbox, actor-profile, household, and referral records.
5. Returns only ordinary test credentials, fixture IDs, and provider-capability booleans.
6. Saves one ignored Playwright storage state per role.

`e2e/global.teardown.ts` calls the same endpoint with `cleanup`. Cleanup recalculates deterministic IDs; removes run-prefixed uploads, messages and their audit events; deletes fixture users; and rejects non-`e2e-` run IDs. The workflow compares exact before/after dumps for `public`, Storage, Auth users, and Auth identities and separately requires zero remaining `e2e-` Auth users.

The upload fixture is a tiny namespaced text file containing no student data. Cleanup is idempotent.

## Commands and evidence

```text
npm run playwright:smoke
npm run playwright:e2e
npm run playwright:a11y
npm run playwright:deployed
npm run playwright:report
```

Playwright runs desktop Chromium and mobile Chromium. CI keeps screenshots on failure, traces on first retry, final-failure video, the HTML report, and `test-results/pr3-status.json` for 14 days. The reporter distinguishes `PASSED`, `FAILED`, `BLOCKED`, and `NOT RUN`; shared fixture failure is fatal, while an unavailable optional provider remains explicitly blocked.

## Final acceptance matrix

The result is taken from deployed browser evidence, never inferred from implementation or unit tests.

| #   | Journey                                                                     | Result                                                                                         |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | Sign-in, sign-out, persistence, nested refresh                              | PASSED                                                                                         |
| 2   | Student home and all persisted Meet presentation states                     | PASSED                                                                                         |
| 3   | Desktop public booking, validation, unavailable slots, free/varying pricing | PASSED                                                                                         |
| 4   | Mobile public booking and reflow                                            | PASSED                                                                                         |
| 5   | Messaging, coach identity, and safe reply                                   | PASSED                                                                                         |
| 6   | Assignment/current-work access isolation                                    | PASSED                                                                                         |
| 7   | Namespaced safe fixture upload and teardown removal                         | PASSED                                                                                         |
| 8   | Package/payment UI                                                          | PASSED                                                                                         |
| 8a  | Stripe test Checkout handoff                                                | BLOCKED — no staging `sk_test_` secret is configured; no live-mode or paid substitute was used |
| 9   | Actor edit, review, publication, and public page                            | PASSED                                                                                         |
| 10  | Referral copy and pending/earned/redeemed states                            | PASSED                                                                                         |
| 11  | Guardian/household access isolation                                         | PASSED                                                                                         |
| 12  | Student coach-route, coach-data, and unrelated-student denial               | PASSED                                                                                         |
| 13  | Keyboard-only booking, messaging, settings, payments, dialogs, and menus    | PASSED                                                                                         |

Stripe-only blocking is intentional and visible. It is not counted as a pass. Google-backed UI states use deterministic persisted fixtures; no isolated Google test account was configured, so no live provider mutation is claimed.

## Accessibility acceptance

Deployed axe scans cover login, public booking, student home, inbox, current work, payments, settings, actor profile, guardian home, and a representative coach workspace on desktop, plus login and booking on mobile. Focused scans cover the material dialog, form validation, pagination, and live/status regions. Component-level axe covers dialog, pagination, labelled form, status, and alert primitives.

- Serious and critical violations fail the suite.
- No axe rule is globally disabled.
- The material-upload label discovered at 4.4:1 was corrected rather than excluded.
- Actor-profile save feedback is exposed as a polite status region.

## Verification record

| Check                                                | Result                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Focused fixture contract tests                       | PASSED — 2 tests                                                                                    |
| Complete Vitest suite                                | PASSED — 249 tests in 44 files                                                                      |
| TypeScript                                           | PASSED                                                                                              |
| ESLint                                               | PASSED — zero errors                                                                                |
| Prettier check                                       | PASSED                                                                                              |
| Production build                                     | PASSED                                                                                              |
| Bundle budget                                        | PASSED in configured warning band                                                                   |
| Secret scan                                          | PASSED                                                                                              |
| Production dependency audit                          | PASSED — zero vulnerabilities                                                                       |
| Supabase reset, lint, pgTAP/RLS, generated-type diff | PASSED in GitHub Actions                                                                            |
| Desktop/mobile smoke                                 | PASSED                                                                                              |
| Journeys 1–7 and 9–13                                | PASSED                                                                                              |
| Journey 8 package/payment UI                         | PASSED                                                                                              |
| Journey 8 Stripe Checkout                            | BLOCKED — test-mode provider secret unavailable                                                     |
| Authenticated/public axe                             | PASSED                                                                                              |
| Fixture cleanup                                      | PASSED — exact public, Storage, Auth-user, and Auth-identity baselines; zero remaining `e2e-` users |
| Cost                                                 | PASSED — `$0/month`; no paid resource or setting enabled                                            |
| Production isolation                                 | PASSED — production was not queried, mutated, configured, or deployed                               |

The authoritative run is the successful required **Deployed browser checks** attached to PR #13 at the documented branch head. Production checks on that same head are also required before handoff.

## Rollback

Reverting PR3 removes the fixture endpoint, Playwright journeys, role storage-state setup, sign-out controls, and CI expansion. PR3 adds no migration and needs no database rollback. An interrupted run can be cleaned by rerunning the same `E2E_RUN_ID` with the `cleanup` action.
