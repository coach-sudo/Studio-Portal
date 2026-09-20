# PR3 deployed Playwright and accessibility verification

## Scope and safety

PR3 is stacked on `codex/pr2-query-layer`. It does not merge PR1/PR2, deploy production, enable the query-layer flag in production, or create paid infrastructure.

Deployed browser checks refuse `portal.d-a-j.com`, `www.portal.d-a-j.com`, and subdomains of `portal.d-a-j.com`. The fixture endpoint also refuses Netlify's `production` context, requires a timing-safe token comparison, and accepts only bounded `e2e-` run IDs. Service-role credentials remain inside the Netlify Function and are never returned to Playwright or browser storage.

## Fixture lifecycle

`e2e/global.setup.ts` sends a namespaced run ID to `POST /api/e2e/fixtures`. The token-protected preview-only function:

1. Resolves the dedicated staging studio from `E2E_STUDIO_ID`, `STUDIO_ID`, or the staging `STUDIO_SLUG`.
2. Idempotently removes records for the same deterministic run.
3. Creates four ephemeral Supabase Auth users and portal accounts: coach, student, guardian, and an unrelated student.
4. Creates deterministic lesson, booking service, package/payment, assignment/material, inbox, actor-profile, household, and referral records.
5. Returns only ordinary test usernames/passwords, fixture IDs, and provider-capability booleans. It never returns Supabase keys or provider secrets.
6. Saves one ignored Playwright storage state per role.

`e2e/global.teardown.ts` calls the same endpoint with `cleanup`. Cleanup recalculates exact deterministic IDs, removes uploaded objects whose original filename begins with the validated run ID, removes any messages within the deterministic conversation, and deletes the fixture users. It cannot accept a non-`e2e-` run ID and never performs a broad studio deletion.

Uploaded test content is a tiny text fixture named `<run-id>-safe.txt` and contains no student data. Cleanup is idempotent, so a failed run can be retried with the same `E2E_RUN_ID`.

## Non-production prerequisites

- A dedicated Netlify staging/Deploy Preview site.
- Staging Supabase values already used by that site.
- The same randomly generated `E2E_FIXTURE_TOKEN` in the staging Netlify environment and GitHub secret `STAGING_E2E_FIXTURE_TOKEN`.
- Optional Stripe **test-mode** secret and webhook for the real Checkout handoff test.
- Optional isolated Google test account for live provider integration. Persisted Meet presentation states do not require it.

No paid plan or new paid resource is required. Secrets must not be pasted into source, workflow YAML, Playwright reports, or PR comments.

## Commands

```text
npm run playwright:smoke
npm run playwright:e2e
npm run playwright:a11y
npm run playwright:deployed
npm run playwright:report
```

All browser commands require `STAGING_BASE_URL`. Fixture-backed runs also require `STAGING_E2E_FIXTURE_TOKEN`. The reporter writes `test-results/pr3-status.json` and distinguishes `PASSED`, `FAILED`, `BLOCKED`, and `NOT RUN`.

Artifacts are written to `playwright-report/` and `test-results/`. CI retains screenshots on failure, traces on first retry, video for failing attempts, the HTML report, and the machine-readable status report for 14 days.

## Journey matrix

The result column is updated from deployed evidence; a nearby unit test or implementation is never treated as a deployed pass.

| #   | Journey                                          | Spec                                 | Current result                                                       |
| --- | ------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------- |
| 1   | Sign-in, sign-out, persistence, nested refresh   | `e2e/auth-and-authorization.spec.ts` | NOT RUN — PR3 preview has not run yet                                |
| 2   | Student home and Meet presentation states        | `e2e/student-experience.spec.ts`     | NOT RUN — PR3 preview has not run yet                                |
| 3   | Desktop public booking                           | `e2e/public-booking.spec.ts`         | NOT RUN — PR3 preview has not run yet                                |
| 4   | Mobile public booking and reflow                 | `e2e/public-booking.spec.ts`         | NOT RUN — PR3 preview has not run yet                                |
| 5   | Messaging and coach identity                     | `e2e/student-experience.spec.ts`     | NOT RUN — PR3 preview has not run yet                                |
| 6   | Assignment/current-work isolation                | `e2e/student-experience.spec.ts`     | NOT RUN — PR3 preview has not run yet                                |
| 7   | Safe fixture upload and deletion                 | `e2e/student-experience.spec.ts`     | NOT RUN — PR3 preview has not run yet                                |
| 8   | Package/payment UI and Stripe test Checkout      | `e2e/payments-and-actor.spec.ts`     | NOT RUN — real Checkout becomes BLOCKED if a test-mode key is absent |
| 9   | Actor edit, review, publication, public page     | `e2e/payments-and-actor.spec.ts`     | NOT RUN — PR3 preview has not run yet                                |
| 10  | Referral copy and pending/earned/redeemed states | `e2e/student-experience.spec.ts`     | NOT RUN — PR3 preview has not run yet                                |
| 11  | Guardian/household access isolation              | `e2e/auth-and-authorization.spec.ts` | NOT RUN — PR3 preview has not run yet                                |
| 12  | Student coach-route/API/data denial              | `e2e/auth-and-authorization.spec.ts` | NOT RUN — PR3 preview has not run yet                                |
| 13  | Keyboard-only critical workflows                 | `e2e/keyboard.spec.ts`               | NOT RUN — PR3 preview has not run yet                                |

## Accessibility coverage

`e2e/accessibility.spec.ts` scans login, public booking, student home, inbox, current work, payments, settings, actor profile, guardian home, and a representative coach/student workspace. Focused scans cover dialogs, forms, pagination controls, and live/status regions. `src/components/Primitives.a11y.test.tsx` runs component-level axe checks on dialog, pagination, form-label, and status/alert primitives.

Serious and critical violations fail the deployed suite. No axe rule is globally disabled. If later evidence finds a defect whose product change belongs to PR6, it must be recorded here with its rule, screen, and reason; it may not be hidden by a broad exclusion.

## Provider-blocked behavior

Fixture-renderable states run regardless of Google or Stripe connectivity. Only the real Stripe Checkout handoff and any future live Google integration test may be `BLOCKED`. A blocked test carries a `BLOCKED:` annotation, appears as a GitHub warning, and is included in the JSON/journey matrix; it is not counted as a pass. Missing general fixture infrastructure blocks fixture-backed journeys with the exact setup reason.

## Rollback

Reverting PR3 removes the fixture endpoint, Playwright journeys, role storage-state setup, sign-out controls, and CI expansion. It does not require a database rollback because PR3 adds no migration or persistent schema change. Any interrupted fixture run can be cleaned by rerunning with the same `E2E_RUN_ID` and `cleanup` action.
