# Wave 1 consolidated acceptance and Wave 2 readiness

October 18, 2026, Eastern. **Auth PASS; hosted infrastructure/public-page scope PASS with the platform accessibility finding retained; authenticated UI01–UI09 BLOCKED PENDING AUTHORIZATION. Production remains NO-GO.**

This single checkpoint is directly dependent on draft [PR #55](https://github.com/coach-sudo/Studio-Portal/pull/55), head `06e51be1eaad66abef39abff1e6fadb89349e131`. Draft #54 remains `49a9451472914b2310f941873e6b5b47fa30f888`, based on unchanged draft #53 at `825d5f2db33a3a3d2749e4fa45e54873faeee838`. All were verified open and draft. Application, functions, dependencies and migrations remain pinned to **`f5324b203387a158df3c050569b95a9044368bc0`**. The only code change here is the acceptance executor's environment-order comparison and its regression test; no Wave 2 implementation or new deployment occurred.

The [master plan](studio-portal-modernization-master-plan.md) remains the complete required scope. Read this report with the [final application candidate](wave-one-final-ui-candidate.md), [actual deployment](wave-one-final-ui-deployment.md), [historical hosted browser results](wave-one-candidate-browser-acceptance.md), [completed H01–H16 backend acceptance](wave-one-hosted-execution-checkpoint.md), and [UI executor/cleanup review](wave-one-ui-mutation-executor.md). Historical failures and verification limits remain valid records.

## Decision

| Decision                    | Status and exact boundary                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Staging Auth                | **PASS** — one supported narrow update; independent full read-back                                                                                     |
| Hosted read-only acceptance | **BLOCKED in part** — infrastructure/public pages PASS; authenticated priorities require the separate UI gate; platform accessibility finding retained |
| UI01–UI09                   | **BLOCKED PENDING AUTHORIZATION** — zero cases executed, no fixtures, cleanup not started or needed                                                    |
| Wave 1                      | **Incomplete acceptance** — implementation/local and H backend foundations verified; mandatory hosted UI closure remains open                          |
| Wave 2 development          | **GO for isolated development after final review**, starting with PR 2.1 foundations; workflow activation/sign-off gates below remain explicit         |
| Production                  | **NO-GO** — no release, publication, merge or production operation authorized                                                                          |

Wave 2 readiness does not turn pending Wave 1 work into completed work. No observed application defect currently invalidates isolated record-link/URL-state development. Missing hosted UI, monetary/provider and manual accessibility proofs continue to gate their relevant acceptance and production release. Start no Wave 2 code in this sprint.

## Auth and infrastructure

Staging Supabase is `lrxrivfqjpkvygozphoz`; Netlify is `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`; synthetic studio is `4ceff683-e72f-4b2e-96ce-85db2dca4eb2`. Production targets were excluded.

The protected application remains **[6ad4c3817ca9519157e3e3b0](https://6ad4c3817ca9519157e3e3b0--coachd-staging.netlify.app)**: ready, `deploy-preview`, unpublished, with the same 23 Node 22 function digests. No additional deployment was created. All-deploy Netlify team login and stopped automatic builds remain in place. Published staging `6ace53e7f850061d7c49b711` and the previous protected draft are preserved. The ten preview variables, function-only service/fixture secrets and absent provider/shared-team credentials are unchanged.

Auth was still configured to the previous draft. The existing reviewed helper and Supabase CLI **2.117.0** produced a minimal diff with exactly two declared updates, zero local-only properties and unchanged unmanaged/undeclared settings. One supported `config push` applied only those approved URL properties. Independent complete Auth reads prove exactly `site_url` and `uri_allow_list` changed; all **241 unrelated properties** are deeply equal. Desired-config diff now has zero updates. SMTP, OAuth, hooks, security, JWT and templates were preserved; no messages or sign-ins were requested. Backslash escaping follows the [Supabase redirect specification](https://supabase.com/docs/guides/auth/redirect-urls).

Before origin: `https://6ad39275e099502cb54a8f64--coachd-staging.netlify.app`.

Final Site URL and exact redirect allowlist:

```text
https://6ad4c3817ca9519157e3e3b0--coachd-staging.netlify.app

https://6ad4c3817ca9519157e3e3b0--coachd-staging.netlify.app/auth/callback
https://6ad4c3817ca9519157e3e3b0--coachd-staging.netlify.app/auth/callback\?**
```

There is one literal backslash before `?`; TOML doubles it. No old host, localhost or broad wildcard host remains allowed. Do not push Auth again merely to refresh evidence.

Verified direct TLS/hostname checks and the executor's required `pg_catalog` search path reproduce schema seal `24828e13e95714c1c42a0734fc6a6dfcb63f33a2947734cdcdbeee751efca3f4`. The complete **57 migration rows** and four manual accounts' full Auth rows remain unchanged. Fresh snapshots preserve **all 76 business tables / 215 pre-UI baseline rows**: 37 original rows plus 178 retained H01–H16 rows. None were added or removed by this sprint. These are synthetic staging records, not production evidence.

## Existing evidence retained without redundant reruns

| Scope                                | Classification        | Evidence and limits                                                                                                                              |
| ------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Application unit/integration         | PASS                  | 818 tests / 117 files at the unchanged application candidate                                                                                     |
| Candidate local browser matrices     | PASS                  | 102 checks in each query mode; loopback fixtures, not hosted Auth                                                                                |
| Original security/executor scenarios | PASS                  | 52 prior guards and 17 disposable scenarios; local Auth/REST adapters are not hosted vendors                                                     |
| Database lifecycle/concurrency       | PASS                  | 57 migrations, 204 pgTAP assertions and three real separate-session suites                                                                       |
| H01–H16 canonical hosted backend     | PASS                  | 16/16 and reviewed cleanup; no rerun, no substitution for HTTP/UI/provider acceptance                                                            |
| Final deployment artifacts           | PASS                  | Existing Linux evidence: 23 function hashes, 117 client chunks, 124 actual static files; ordinary bundle caps pass with the CSS warning retained |
| Executor row-order defect            | PASS after repair     | Live API reproduced different order with identical per-key values/metadata; 53 focused guards now pass; scoped lint has zero errors/warnings     |
| GitHub CI                            | BLOCKED / not claimed | Dependent drafts reported no checks; local evidence is not described as green GitHub CI                                                          |

The 818-test suite, 102-per-mode matrices, migration replay, pgTAP, concurrency and 17 disposable scenarios were not rerun merely for newer timestamps. Source and evidence provenance distinguish those existing results from this sprint's fresh focused checks.

## Fresh protected public-browser checks

The renewed **Netlify-only** perimeter session contains exact-host secure cookies and no application storage. The existing hosted acceptance guard and release verifier were reused without their role-login setup. An additional fence permitted only same-origin GET/HEAD reads; every POST, external font request and WebSocket was blocked before transmission. No account credentials were entered, no form was submitted and no Coach'D session was created.

Six actual hosted configurations passed: Chromium at **320, 390, 768 and 1440 px**, and WebKit at **320 and 1440 px**. Each checked login width/control geometry, email-to-password Tab order, blank-password visibility, the non-submitting password disclosure and unauthenticated coach/portal route protection. There was no page overflow or uncaught page error. Coach routes correctly use `/coach/login`; portal routes use `/login`. An initial probe used the portal destination for coach too; that probe expectation was corrected from inspected existing source, without an application change.

**12 axe audits** retain **12 repeated occurrences of one moderate platform-owned `region` finding**, targeting `#nl-hud-frame` / `.nl-bar`; zero serious/critical findings were observed. The toolbar was neither removed nor excluded. Full findings, incomplete rules and screenshots remain private. Narrow Chromium and WebKit screenshots were visually inspected. Decorative external fonts were deliberately blocked, so this is fallback-font geometry, not full provider/font or manual accessibility acceptance. Authenticated navigation/dialog geometry remains untested here.

All **13 client/static assets actually received during these public checks** match the approved artifact bytes. This supplements the existing complete local 117-chunk/124-static and 23-function evidence; it does not claim a fresh served download of every asset. Protected health returned HTTP 200, `status: ok`, commit `f5324b203387`, context `deploy-preview`, at `2026-10-18T16:44:04.974Z`. Independent anonymous root/health requests still return 401. A post-browser read-only bookend again verifies unchanged Auth, all original Auth identities, 57 full migration rows, all 215 business rows, H journal, environment, publication and deployment list.

## Hosted UI and remaining acceptance

Historical #53 acceptance remains **139 checks: 132 passed, three guardian geometry failures, four fixture blockers**, plus its duplicate-landmark and account-text findings. Its **54 platform-owned `region` occurrences** remain recorded. Later local B01/B02/B03 passes do not erase those hosted findings. The new authenticated candidate has not been inspected as a coach, student or guardian in this sprint.

| Required item                                                | Current classification               | Remaining proof                                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Netlify preview toolbar landmark                             | FAIL — platform-owned moderate issue | 12 current occurrences of one `region` issue; 54 historical occurrences retained separately. No toolbar removal or exclusion; vendor/presentation acceptance remains open. |
| Guardian banner at 320/390/768/1440                          | BLOCKED                              | Authorized new guardian session; historical hosted failures remain unresolved as hosted acceptance                                                                         |
| Coach Overview landmarks; student/guardian credit text       | BLOCKED                              | Exact final hosted role screens; local fixes already verified                                                                                                              |
| Coach/student/guardian existing-lesson workflows             | BLOCKED                              | UI01/UI03/UI07/UI08 against the new seeded/generated records                                                                                                               |
| Populated lesson-credit and audit history                    | BLOCKED                              | UI04/UI05/UI06/UI08; four lesson credits and zero cash only                                                                                                                |
| Guardian revocation and fresh denial                         | BLOCKED                              | UI08; root claim-access remains prohibited and is blocked before transmission                                                                                              |
| Frozen bulk scope, duplicate execution, stale review         | BLOCKED for hosted UI                | UI05/UI06; existing canonical/backend and local proofs remain PASS                                                                                                         |
| Exact cleanup and original 215-row preservation after UI     | BLOCKED / not run                    | UI09 plus independent all-table/retained/Auth proof                                                                                                                        |
| Nonzero money/invoice/payment history                        | BLOCKED                              | Outside this zero-cash proposal; requires separate isolated fixtures/authority                                                                                             |
| Stripe/Calendar/email delivery and scheduled cadence         | BLOCKED                              | Isolated provider credentials, delivery sink, explicit execution authority; declared legacy timers are not cadence acceptance                                              |
| Native 200% zoom, screen reader and human usability sign-off | BLOCKED                              | Manual acceptance; automated axe/viewport checks do not prove these                                                                                                        |
| Navigation/search redesign; Materials 2.0 and later waves    | DEFERRED to their approved waves     | Required master-plan work is preserved, not removed                                                                                                                        |

The rescheduling/conflict HTTP wrappers can call Google before SQL and remain prohibited in the provider-free UI run. H06's SQL result does not establish those wrappers. Native lesson creation remains a single submission with no ambiguous retry, and service-side actor-null audit entries remain accepted only for exact acknowledged actions/entities/UUIDs. These known boundaries are not silently repaired, broadened or called fully accepted here.

## Prepared single UI execution gate

No independently authorized hosted UI receipt exists. The new run remains `e2e-wave1-ui-20261017-a`; deterministic proposed Auth/business IDs are all absent. Existing manual accounts and H identities/journal are not reused. A valid existing staging legacy service JWT was checked through a read-only planned-user lookup; no credential was generated, rotated or disclosed.

The reviewed implementation was reused. One genuine preparation blocker was repaired: Netlify may return identical variable rows in different orders. The attestation now sorts rows by key before hashing **all** values, contexts, scopes, secret flags and metadata. Changes to any of those fields still fail; caller data is not mutated. No endpoint, payload, authorization, mutation, retry or cleanup rule changed. The [current proposal](wave-one-finalization-ui-proposal.json) records the resulting executor seal and exact target/artifact/baseline hashes; the older executor report/hash remains historical evidence.

Private configuration, actual 124-file/23-function receipt, fresh complete baseline and an explicitly **unapproved** proposed receipt are prepared under `C:/Users/dariu/.codex/private/studio-portal-staging/wave-one-finalization-20261018/ui-run/`. Files enforce Owner/SYSTEM ACLs. The config points to an absent `authorization.json`; `authorization.proposed.json` has an empty approver and fails the approval validator. No hosted UI journal, accounts, fixtures or cleanup was created. Execution still fails closed before network activity without human authorization.

The proposed window ends **October 19, 2026, 12:33:05 p.m. Eastern** (`2026-10-19T16:33:05.780Z`), no later than 24 hours after the proposal's start. This is not an issued authorization. Fresh protection, perimeter/health, configuration, migrations, original Auth and all-table fingerprints must pass immediately before any later approved execution. Changed baselines, expired approvals or unknown/ambiguous outcomes stop the run; no silent rebaselining or timestamp extension.

| Hard limit                                                   |                     Maximum |
| ------------------------------------------------------------ | --------------------------: |
| New synthetic Auth users / students / lessons                |                  4 / 2 / 13 |
| Lesson credits / cash and payment transactions               |                       4 / 0 |
| HTTP mutation/session attempts                               | 30 (24 business, 6 session) |
| Canonical SQL mutations / reads                              |                    60 / 600 |
| Cleanup transactions / Auth setup-cleanup writes             |                      40 / 8 |
| Reviewed jobs / items per job                                |                      4 / 13 |
| Peak owned rows / cumulative owned identities                |                   384 / 512 |
| External providers / delivered messages / worker invocations |                   0 / 0 / 0 |

Failed, denied and duplicate attempts count. Approval must cover all UI01–UI09 cases **and mandatory exact-ID cleanup together**, including controlled processing of only this run's known bulk items, normal new-account session/rate-limit side effects, removal of three new Auth users and banning/unlinking the retained coach. Retain the two terminal students, required lessons, package/append-only ledger, audits, receipts and deletion snapshot. Never erase financial history, reset staging or automatically retry ambiguous Auth/lesson creation. The operational login rate-limit table is outside the reviewed 76 business tables; its normal increments are not described as unchanged or deleted during cleanup.

## Prioritized Wave 2 backlog — no implementation in this sprint

| Priority / planned PR | Required master-plan work                                                                                                                                                                                                                       | Start and acceptance dependencies                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 / 2.1              | Shared exact-record resolver; URL search/filter/sort/page/view/student context; return/scroll continuity; drawer history and Back; unavailable-state privacy; consistent save/review/error foundations                                          | Can start isolated after review against the approved Wave 1 implementation. Keep credit/bulk semantics intact; hosted workflow acceptance remains open. New exact links and Back behavior need their own cross-role acceptance. |
| P1 / 2.2              | Six coach destinations and grouped Studio; useful Home content moved into Today before `/coach` redirect; actual mobile More; existing URL/query compatibility; My Work/Messages labels; authorized guardian student selector in URL/query keys | Depends on 2.1. Hold final navigation activation/sign-off until UI01/UI08 role/revocation gates and new compatibility/selected-student tests pass. Multi-child authorization needs explicit coverage.                           |
| P1 / 2.3              | Invoker/RLS-backed record search; two-character minimum, 250 ms debounce, five/group and 30 total; expanded bounded paging; published-note snippets; keyboard navigation, cancellation and identity-scoped keys                                 | Depends on 2.1; contract/query design can proceed independently of provider acceptance. Negative-role/snippet/count tests and exact-record navigation gate acceptance. Never return private notes, signed URLs or file bodies.  |

Before branching, recheck approved `main` and migration heads. Use `codex/` branches and short explicit dependencies where unmerged Wave 1 code is required; do not import old stacked PRs or PR #28. No Wave 2 migration is applied here. Monetary/provider/manual accessibility production gates do not block independent resolver/URL-state development, but mandatory unfinished Wave 1 acceptance remains tracked above.

**One remaining execution-authorization request:** approve the exact reviewed UI01–UI09 synthetic workflow and its mandatory cleanup on this deployment, within the proposal's target/code/manifest/artifact/baseline hashes, expiration and unchanged hard limits. No other mutation, deployment, publication, merge, provider, worker, production or Wave 2 authority is included.
