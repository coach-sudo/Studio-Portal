# Wave 1 candidate hosted browser acceptance checkpoint

October 17, 2026 (Eastern). **Read-only testing performed; acceptance remains incomplete. Production remains NO-GO.**

This draft is directly dependent on [PR #52](https://github.com/coach-sudo/Studio-Portal/pull/52), `codex/wave-one-candidate-auth`, head `fdb84120602aa9b7c3a1768cd38ce199e92db03d`. PR #51 remains at `91c47042f1c5a3da2e83c58f6321c708aa546baf`. Both were independently reverified open and draft. Read alongside the [candidate deployment](wave-one-candidate-deployment.md), [Auth checkpoint](wave-one-candidate-auth.md), [release candidate](wave-one-staging-release-candidate.md), [historical acceptance](wave-one-hosted-acceptance.md), and [future UI mutation proposal](wave-one-ui-browser-mutation-proposal.md). Earlier reports retain their original environments and results.

## Exact hosted target and scope

| Property                   | Verified target                                                |
| -------------------------- | -------------------------------------------------------------- |
| Application                | `830c762bdaf085f5e20a91f4e6a7afbef4afa627`                     |
| Deployment                 | `6ad39275e099502cb54a8f64`                                     |
| Origin                     | `https://6ad39275e099502cb54a8f64--coachd-staging.netlify.app` |
| Netlify staging            | `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`                         |
| Supabase staging           | `lrxrivfqjpkvygozphoz`                                         |
| Synthetic studio           | `4ceff683-e72f-4b2e-96ce-85db2dca4eb2`                         |
| Original synthetic student | `be0657a3-0f36-477a-949a-491afb24809c`                         |
| Runtime                    | Ready, unpublished, `deploy-preview`, V2 enabled               |

Only existing synthetic coach, student, guardian and unrelated identities were used. Three successful real application password sign-ins verified the expected identities. The unrelated account's application login was denied; its separate existing Supabase Auth identity was used for negative read tests. No application identity state was copied between roles. No hosted business mutation, fixture, provider, worker, deployment, publication, configuration change or H01–H16 rerun was performed.

Protected health returned `status=ok`, commit `830c762bdaf0`, context `deploy-preview` at `2026-10-17T16:37:50.874Z`. Root and health were 401 without a perimeter session. The supported Netlify connector confirmed team-login protection for **all** deployments. The previous staging publication remains `6ace53e7f850061d7c49b711`; builds remain stopped and the deployment list is unchanged.

## Hosted results and outstanding rerun

The initial 132 distinct checks completed with **121 passed, 7 failed and 4 fixture-blocked** (reported by Playwright as skipped; these are not an additional four skipped checks). Automatic retries were disabled. The run began `2026-10-17T16:39:29.490Z` and took 681.683 seconds.

After the pause, the narrowly selected rerun stopped in global setup because the protected Netlify session had expired. **Zero test bodies ran in that attempt.** It must not be counted as seven new failures, a successful rerun, or completed acceptance. A fresh normal team-login window was opened; the user interaction is pending. Existing results and the expired-session report are retained separately.

The harness now waits up to 20 seconds for assertions instead of the default five seconds. It also distinguishes the contact's portal-access badge from the student's matching access label. These changes have not yet received a hosted rerun. Missing-lesson delivery reads were independently audited in `lesson-delivery-status.ts`: RLS verifies the lesson before bounded projection/outbox reads, with no writes or provider calls. The request fence now permits only GET for the deliberately missing UUID `00000000-0000-4000-8000-000000000001`, with no query/hash; arbitrary IDs and mutating methods remain denied.

| Initial failure                      | Classification and evidence                                                  | Remaining verification                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Guardian desktop responsive audit    | Main absent after 5 seconds; snapshot still says “Preparing your workspace…” | Recheck with the longer wait; no claim that an application defect is ruled out |
| Student desktop financial navigation | Same loading-state timeout                                                   | Recheck UI/backend agreement after navigation and refresh                      |
| Guardian desktop V2 continuity       | Same loading-state timeout                                                   | Recheck real snapshot responses and identity after reload                      |
| Coach missing lesson                 | Still loading the lazy section when the redirect assertion expired           | Recheck exact safe list redirect                                               |
| Student missing lesson               | Still preparing workspace when the redirect assertion expired                | Recheck exact safe list redirect                                               |
| Guardian missing lesson              | Fence prevented the previously unreviewed delivery read                      | Recheck redirect and safe denial under the narrowly reviewed read fence        |
| Coach Household access review        | Test locator matched both student and contact badges                         | Recheck contact-specific label and drawer permissions/focus without saving     |

Six newly added guardian banner geometry checks and the final guardian logout check also remain unexecuted hosted checks. They are not included in the initial 132. Logout is deliberately last so it cannot invalidate the guardian session before the matrix.

## Coverage and limitations

| Surface       | Evidence                                                                                                                                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coach         | Dashboard, Today, calendar/bookings, roster, Inbox, Library, finance, Settings, original student's Overview/Household/Payments/Lessons/Work/Notes routes rendered; safe credit enablement preview was closed without saving; bounded bulk-candidate read returned zero items and no queued effects |
| Student       | Expected identity, navigation and refresh, schedule/work/settings/account views, authorized financial/coverage reads, and read-only credit controls                                                                                                                                                |
| Guardian      | Expected identity, correct linked student, permitted work/schedule/finance and Settings; desktop continuity/audit reruns remain outstanding                                                                                                                                                        |
| Unrelated     | RLS and summary/finance denials, direct coach workspace fences, no private student workspace; exact negative-read tests passed                                                                                                                                                                     |
| Finance       | Real `student_financial_overview` and `student_credit_coverage` responses agreed with zero-account UI metrics across tested roles/viewports, subject to the one outstanding desktop student navigation check; authenticated invoice HTTP reads returned empty invoice arrays                       |
| Query layer   | Actual `studio_route_snapshot` traffic observed; hosted V2 only. No hosted legacy-mode claim                                                                                                                                                                                                       |
| Keyboard      | Repeated search/More focus entry, forward/reverse Tab containment, Escape and opener restoration passed in all six hosted projects                                                                                                                                                                 |
| Narrow layout | Corrected coach student identity width at 320 px passed; screenshots show readable student name and stacked actions                                                                                                                                                                                |

Chromium tested 1440×1000, 768×1024, 390×844 and 320×740. WebKit tested 1440×1000 and 320×740. Desktop Chromium runs the complete suite; the other projects run responsive and keyboard checks, with extra identity checks on desktop WebKit. This does not establish WebKit acceptance at 390 or 768 px.

The verified existing fixture has no lessons, packages, ledger entries, invoices, notes, resources or material links. Four explicit blocked cases cover populated coach/student/guardian lesson detail and nonzero finance/history. Missing-ID redirects do not replace real lesson-detail acceptance. No fixtures were created to fill these gaps.

Forged coach URLs from portal identities expose no coach workspace. Their subsequent root landing cannot be fully accepted because `/api/v2/auth/claim-access` remains blocked before transmission. Provider-capable `/api/v2/health` is likewise deliberately blocked. These boundaries are reported, not mocked into successful endpoint tests.

## Accessibility and screenshot review

There are **51 completed page audits** in the initial report: **0 critical, 0 serious, 53 moderate rule occurrences, 0 minor**. Counts are occurrences per audited page, not distinct defects. The incomplete guardian desktop group contributes no completed attachment. Fifty-two screenshots exist, including a partial group's screenshot; screenshot count is not audit count.

The 53 moderate occurrences comprise:

- **Two `landmark-unique` occurrences**, coach Overview at 1440 px in Chromium and WebKit. The unnamed application sidebar and student-context complementary landmarks reproduce the known finding from PR #50. The finding remains in the deployed application.
- **51 `region` occurrences** targeting the injected Netlify preview-toolbar frame/bar. These are retained in full audit totals and identified separately as platform UI; the toolbar was not disabled or excluded to obtain a clean result.

Eight screenshots were manually reviewed: coach Household at 320 Chromium and 1440 WebKit; coach Payments at 768 Chromium and 320 WebKit; student Payments at 390 Chromium and Home at 1440 Chromium; guardian Work at 768 Chromium and Home at 320 Chromium. The review found a guardian banner/bell overlap missed by page-overflow assertions. Student names in the corrected coach header wrap visibly; financial sections reflow and separate dollar credit from amount due and lesson credits. Full-page images include fixed mobile navigation at the original viewport position; this alone does not prove bottom-of-page controls are obscured. A student Home credit summary is visibly ellipsized at desktop width and remains a presentation issue.

Native 200% zoom, screen-reader behavior, complete touch-target review, human task usability, and populated long-history/table review remain outstanding. The existing 720 px reflow probe is not a native zoom test.

## Issue register and undeployed fixes

| ID / severity                         | Reproduction / root cause                                                                                                                 | Fix and status                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B01 / moderate accessibility          | Coach Overview, 1440 Chromium/WebKit: two unnamed complementary landmarks                                                                 | Add distinct `Studio sidebar` and `Student context` labels, including both overview query-mode paths. Four local Chromium/WebKit checks passed across V2 and legacy modes, with an explicit zero-`landmark-unique` assertion. **Undeployed; another reviewed candidate/deployment is required.** |
| B02 / medium layout                   | Guardian Home 320 px and Work 768 px: upper-right notification bell covers household identity/relationship text; no banner space reserved | Reserve right-side space and permit identity wrapping. Ten local geometry checks passed across five project configurations and both query modes. Six hosted regression probes prepared but not yet executed. **Undeployed.**                                                                     |
| B03 / low presentation                | Student Home, desktop: account credit summary uses an ellipsis                                                                            | Unchanged; full financial values remain accessible on Payments. Include in the usability walkthrough                                                                                                                                                                                             |
| B04 / moderate platform accessibility | Settled audited pages: Netlify toolbar content lacks a containing landmark                                                                | Platform-owned; unchanged and included in findings. Do not weaken staging protection to remove it                                                                                                                                                                                                |
| T01 / harness                         | Default 5s assertions scored transient hosted loading states                                                                              | 20s wait prepared; affected hosted checks still need rerun                                                                                                                                                                                                                                       |
| T02 / harness                         | Household portal-access text was not unique                                                                                               | Contact status locator corrected; hosted rerun pending                                                                                                                                                                                                                                           |
| T03 / harness safety boundary         | Missing lesson mounted a delivery-status read absent from the original allowlist                                                          | Exact absent-ID GET independently reviewed and policy-tested; broader delivery access remains blocked                                                                                                                                                                                            |
| E01 / perimeter                       | Normal team session expired across the pause                                                                                              | Fresh legitimate login requested; no bypass or access-control change                                                                                                                                                                                                                             |

Only presentation and testing code changed. No migration, financial, credit lifecycle, authorization policy, provider or hosted application code was changed.

## Local validation

- **64/64** security/request-policy unit tests passed, including off-target, production, mutating, decorated-URL and absent-ID delivery restrictions.
- **7/7** protected-browser/Auth helper tests passed earlier in this checkpoint.
- **14/14** focused local browser checks passed: four landmark checks plus ten guardian layout checks. These use local fixture transport and are explicitly not hosted business acceptance.
- Typecheck, build, changed-file formatting and diff checks passed. ESLint: zero errors, two existing AppShell label/autofocus warnings on unchanged controls.
- Bundle failure budgets passed: largest JavaScript 111,672 gzip bytes; CSS 23,127 gzip bytes. Existing 22,000-byte CSS warning remains below the 25,000-byte failure budget.
- Secret scan passed for 930 tracked and untracked files, including the sanitized checkpoint reports.

No database lifecycle replay, concurrency suite, H01–H16 mutation run or full historical unit suite is claimed as freshly rerun for these presentation changes.

## Infrastructure and data preservation

The initial preflight and fresh revalidation at `2026-10-18T03:15:46.081Z` agree: all **76 business-table counts and SHA-256 fingerprints match**, totaling **215 rows** including retained H01–H16 evidence. Four original accounts remain confirmed with their original roles; the unrelated account has no studio membership. Existing student/contact/relationship permissions were verified before sign-in and are included in the unchanged table fingerprints.

The post-browser read-only bookend at `2026-10-18T03:19:54.129Z` additionally verified all **57 complete migration rows unchanged** (SHA-256 `ce98bf8958cfbf42981ebce73ec8d935329c06e43473fd2ad13c25824796c972`), schema seal `24828e13e95714c1c42a0734fc6a6dfcb63f33a2947734cdcdbeee751efca3f4`, and **zero changed tables**. An earlier diagnostic omitted the documented `search_path=pg_catalog` session setting and rejected the differently qualified deparser digest. It was corrected read-only; the rejected digest was not adopted as a baseline and no database repair was attempted. Repeat this bookend after any resumed hosted checks.

Auth Site URL remains the immutable origin above, with exactly `/auth/callback` and `/auth/callback\?**` redirect entries. Full Auth configuration hash remains `5f42ae2f40c945c42ded8081780add40d874eba1c5c927e1567c6f05a256af92`. Ten preview-scoped variables remain configured; V2 remains true, function secrets remain isolated, and no Stripe/Google/Gmail/SMTP variables were added.

Normal authorized Auth/session and public-endpoint rate-limit metadata are outside the approved 76 business-table baseline. Business fingerprints, including membership, contact, lesson, invoice, ledger, audit, outbox and projection tables, must remain identical. Read-only database verification uses the exact staging direct endpoint with verified TLS and hostname verification. Private sessions, passwords, tokens, raw reports and screenshots stay in the restricted local evidence directory and are not committed.

Browser/API guards retain exact-origin and endpoint restrictions, zero automatic retries, blocked WebSockets, disabled service workers and redirect-free API probes. The original unexpected missing-lesson delivery read was blocked before transmission. No mocked hosted response was used. Zero agent-requested provider calls, worker invocations or new delivery intent is claimed; no claim is made that historic platform schedules were invoked or tested.

## Resume and next gates

1. Complete legitimate Netlify login in the pending capture window. Revalidate protected health and the unchanged staging targets; establish fresh separate existing synthetic sessions if expired.
2. Run only the seven affected checks, six new banner geometry probes and final logout. Preserve original outcomes alongside rerun results and classify any remaining failures.
3. Finish the post-test 76-table, migration/schema, Auth and Netlify bookend; update this checkpoint with final distinct totals and readiness. No cleanup is authorized if unexpected data changes appear.
4. Review the undeployed fixes. Any new application candidate and protected deployment require separate authorization; never report these fixes as present in `830c762`.
5. Hosted UI mutations still need a separately reviewed ownership/budget/cleanup executor and explicit authorization. Hosted legacy mode needs a separately approved configuration/deployment. Provider acceptance needs isolated test credentials and explicit scope. Complete the human usability/accessibility walkthrough after the appropriate fixture and candidate gates.

The completed H01–H16 backend run is not repeated absent an actual regression. Production remains NO-GO. No Wave 2 work begins.
