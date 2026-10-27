# Weekly audit remediation — October 26, 2026

## Phase 0 findings (before implementation)

Production confirmed through the Netlify project and deploy APIs: `078f3f83a456d049b28c287b69d4e4a46c3f6056`, deploy `6ad8e4ee73c3bc97c37dd94f`, published October 21, locked. The local checkout was clean at `883fe70` on the prior Wave 6 branch. Remediation starts from `origin/main` on `codex/weekly-audit-remediation-2026-10-26`.

### Confirmed problems

- Production intake: 18/18 scheduler requests returned 499 in 12:00–15:00 UTC October 26. Request `01M5WB1KJAQ40KFBQX2DCEWA5B` identifies the client as **Netlify Functions Scheduler**, function operation `provider-intake`, 14.976 seconds, no completed invocation telemetry. This does not prove Lambda never started.
- Maintenance also has repeated scheduler 499 attempts, followed in some slots by 200 responses around 13.5–14.1 seconds. Request `01M5F4F5Y18Q61NRREX441886W` on October 21 returned 502 after 9.292 seconds with an opaque thrown object. Existing code throws PostgREST objects without a worker error boundary.
- Intake performs the full provider scan in the synchronous scheduled handler. The background entry is a separate coach-authenticated route, with no dispatch from the scheduler. Its caught error becomes a returned response even though background return values are discarded, suppressing platform retries.
- Maintenance makes repeated sequential per-booking, per-lesson and per-package reads. Several reads/writes ignore returned database errors. There is no whole-run lease; individual financial/effect jobs have their own claims and locks.
- Installed DOMPurify is pinned to 3.4.15. CSS thresholds are 22,000 advisory / 25,000 failure bytes gzip; the audit reports 24.04 KB. Lint currently has no non-increasing warning inventory.

### Suspected causes, not proven

The synchronous intake workload is inappropriate for a short scheduler request. However, official Netlify documentation specifies a 30-second scheduled limit, whereas observed cancellations are about 15 seconds. Scheduler/client cancellation, cold start and platform routing behavior remain possible contributors. Do not describe this as a proven 15-second Lambda timeout.

Maintenance database statistics inspected read-only: `extend_ongoing_series` mean 19.09 ms / max 776.62 ms; `expire_booking_holds` mean 11.35 ms / max 745.42 ms. These aggregate statistics do not identify the failing October 21 stage. Repeated cross-region HTTP round trips are a plausible latency contributor, not a measured stage attribution.

### Ruled out / existing protections

The deployed artifact includes all four correct schedules: intake every ten minutes; maintenance, calendar and outbox every five minutes. Intake is `stream`; `provider-intake-background` is `background` and has only `/api/v2/admin/provider-intake`. No deployed edge functions. One non-forced SPA rewrite. No demonstrated naming collision or missing artifact. Runtime is Node 22 in us-east-1; production Supabase is us-west-2. Preserve these settings pending measured justification.

Production has all 70 repository migrations, through `20261021135617_provider_intake_review_safety`. Preserve PR #66's transactional review/replay, identity ambiguity rules, occurrence mapping, credit locks, effect leases, Stripe idempotency, fixture denial, protected provider health, secret scanning, generated types and required `verify`, `migrations`, `smoke` gates. No production worker or provider was manually invoked during investigation.

### Unverified risks / release gates

No approved production coach/student/guardian test sessions have been established. Live authenticated checks and provider review-record tests remain blocked until an approved safe identity/provider path is available. Three real scheduled executions require a published candidate and remain pending explicit publication authorization. Staging is SSO protected and currently points to an older deployment. The production deploy API reports `deploy_source: api` / `manual_deploy: false`; current Git-only build policy must be checked separately before release.

## Official references

- [Scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/): synchronous entry, 30-second limit, schedules run only on published deploys.
- [Background functions](https://docs.netlify.com/build/functions/background-functions/): awaited 202 means invocation accepted, not processing success; up to 15 minutes, error retries after one and two minutes.

## Verification and release status

**NO-GO.** The production dependency audit fails for Zod, full fresh-stack checks are blocked locally, hosted authenticated/provider evidence is unavailable, and no repaired artifact has been published. Post-release scheduler verification cannot be claimed before authorized publication. See [the verification matrix](weekly-audit-2026-10-26-verification.md).

## Root causes and implementation

### Scheduled intake

Confirmed code defect: the ten-minute scheduled entry performed the entire synchronous provider scan; there was no background dispatch. The separate background route required a coach JWT and caught exceptions into discarded Responses. Artifact/API evidence rules out a missing function, wrong schedule name or demonstrated identity collision. The 15-second edge cancellation is confirmed, but its exact platform-side cause is **unresolved**: documentation specifies 30 seconds and missing completed invocation telemetry does not prove Lambda never started.

The scheduled entry is now a lightweight dispatcher. A service-only RPC persists an outstanding receipt before an awaited, five-second-bounded background dispatch. Only HTTP 202 acknowledges acceptance. The request is HMAC signed with a domain-separated server-only service key and pinned to the invoking deploy's immutable host. No raw service key is transmitted. Pending receipts survive failed/ambiguous dispatch; the next cadence retries. Background exceptions are safely logged and thrown, enabling platform retries.

A row-locked claim serializes scheduled and coach-triggered work. Twenty-minute leases outlast Netlify's documented hard fifteen-minute worker lifetime; interrupted work can be recovered only after that safety interval. Job IDs and claim tokens fence stale delivery/completion. A successful receipt cannot be replayed by the same delivery. The next cadence creates a new full-scan receipt. A later cadence can be skipped while a long worker owns its lease; acceptance is not processing completion.

Implementation files: `provider-intake.ts`, `provider-intake-background.ts`, new synchronous `provider-intake-admin.ts`, `_shared/provider-intake.ts`, `_shared/scheduled-worker.ts`, `_shared/worker-telemetry.ts`, `_shared/checked-query.ts`. Moving processing out of the scheduled entry keeps provider dependencies out of its initialization path. Existing identity/review/credit logic is retained. Provider items and sources continue independently after a failure; unfinished work fails the overall job for retry. PostgREST failures are checked instead of silently acknowledging lost writes; parallel work settles before a lease is released. Provider reads have explicit request timeouts.

Remaining limits: scanning still reuses the existing Calendar/Gmail windows rather than introducing a new event queue. Provider success, dispatch through protected staging, cold starts and the disappearance of live 499s require hosted verification. Staging has no Google test credentials. Its SSO protection may require an approved machine-access method for dispatcher tests; no protection was bypassed or changed.

### Booking maintenance

Confirmed logging defect: direct throws of PostgREST objects produced `[object Object]`, losing stage and context. Historical request `01M5F4F5Y18Q61NRREX441886W` proves a 502 on October 21. It cannot retrospectively identify which database operation failed. Database timing statistics do not support asserting a sustained slow `expire_booking_holds` or `extend_ongoing_series` query as the root cause. Sequential cross-region requests remain a plausible contributor.

Maintenance now uses the same durable dispatch/claim model, with stages covering bulk effects, booking holds/series, past-due review, notes, credits, gifts, renewals, package notices and retention. Logs contain fixed safe messages, category, retry classification, execution ID and stage/total elapsed times. Raw database/provider messages, tokens, payloads and student rows are not logged. Non-fatal bulk claim failures are also logged safely.

`_shared/maintenance-reads.ts` batches published-note reads and package-ledger reads, explicitly paging ledgers so a partial result cannot become a false balance. Past-due booking identity comes from the initial query. Financial mutations stay sequential and their existing database locks, transactional functions and Stripe idempotency keys remain intact. New background code is in `booking-maintenance-background.ts`; the original schedule/name remains `booking-maintenance` every five minutes.

The migration `20261026161014_reliable_scheduled_workers.sql` is additive: a private RLS-enabled receipt table and three service-only RPCs. No student, lesson, ledger, invoice, occurrence, provider identity or review history is rewritten. Types were generated from the isolated database; the public type diff contains only the three RPCs. Application rollback can leave this private schema in place. No production migration was applied.

### Discovered regressions

- Search's focus trap included listbox buttons with negative tabindex, so its computed last control could never be reached by Tab. Excluding negative-tabindex controls restores trapping. The actual failure reproduced in Chromium and WebKit; the existing browser regression now uses current Search accessible names and passes in both.
- A calendar interaction fixture placed its group two weeks ahead, outside some initial month views. The fixture now shares the visible lesson range; assertions and production behavior are unchanged.
- Actor media used a provider-name substring to choose an iframe. Exact HTTPS host and valid provider-ID checks now preserve YouTube/Vimeo embeds and refuse lookalike hosts, credentials, alternate ports and unsafe schemes. Preview/public renderer and existing editor tests pass; hosted publishing remains unverified.

## Performance comparison

| Path / measure                                | Before                                                                                             | After                                                                               | Evidence / limit                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Production intake, October 26 12:00–15:00 UTC | 18/18 HTTP 499; about 14.97 s; no completed invocation telemetry                                   | NOT YET VERIFIED                                                                    | Netlify edge counts and scheduler request detail; no repaired publication |
| Background dispatch                           | No scheduled dispatch                                                                              | Persist, await 202; 5 s database dispatch-intent timeout and 5 s acceptance timeout | Local regressions; hosted acceptance/latency pending                      |
| Production maintenance                        | Successful samples 13.50–14.11 s, with repeated 14.97–14.99 s 499 attempts; historical 502 9.292 s | NOT YET VERIFIED                                                                    | No claim of production speedup or repaired error rate                     |
| 100 package-ledger reads, one page total      | 100 sequential reads                                                                               | 1 batched read                                                                      | Focused request-count regression; not a production wall-clock benchmark   |
| Global CSS gzip                               | 24,036 bytes                                                                                       | 21,923 bytes                                                                        | Production-shaped local build, unchanged 22,000/25,000 budgets            |

CSS rules were moved into shared booking and existing portal-appearance assets, loaded by their consuming routes/components. No responsive/focus/reduced-motion rules were deleted to meet the budget. Computed-style comparisons match at 320/768/1440 for public booking, coach bookings, login and dark portal Settings. The exploratory `/portal/schedule` URL was not a supported workflow and is excluded from acceptance claims; the actual upcoming-lessons route is `/portal/bookings`.

## Security and dependencies

The user authorized **3.4.17**, superseding the original exact 3.4.16 request. Dependency-only commit: `d23d313`. Only `package.json` and `package-lock.json` changed in that commit, and only DOMPurify's version/tarball/integrity changed. Upstream [3.4.17 release](https://github.com/cure53/DOMPurify/releases/tag/3.4.17) and advisories confirm the additional [detached subtree](https://github.com/cure53/DOMPurify/security/advisories/GHSA-mrv2-3pqr-j5jr) and [shadow-root template](https://github.com/cure53/DOMPurify/security/advisories/GHSA-cg2g-xh64-v4q7) fixes. The original IN_PLACE/raw-text advisories affected through 3.4.15; newer advisories include 3.4.16. The patch removes DOMPurify from the current npm audit results.

Coverage includes malicious markup, IN_PLACE self/parent/sibling-removing hooks, script/style/textarea/title roots, templates, attached shadow DOM, safe formatting and ESM/CommonJS exports. Actor profiles use React text rendering rather than arbitrary HTML; tests verify inert profile text in preview/public rendering, allowed embeds, rejected lookalike URLs and existing builder draft behavior. A live authenticated editor/preview/publish journey is not substituted by these tests.

The live feed differs materially from the historical “one high and one low” report:

| Package / path                      | Advisory / affected range                                                                                                          | Exposure                                                                                                                        | Remediation / compatibility                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `dompurify` direct, 3.4.15          | GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2; newer GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr, GHSA-c6gr-qvv4-5v3f include 3.4.16       | Browser runtime; some issues require non-default DOM/hook/template modes not used by application sanitization                   | Patched to authorized 3.4.17; focused tests pass                                                                                       |
| `zod` direct, 4.4.3                 | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), `<4.6.6`, high                                           | **Production** request/provider validation. Existing collection limits do not establish immunity to oversized-input allocation. | Feed lists 4.6.6; broader minor change requires separate authorization/review. Production audit remains failing. No suppression added. |
| `vite` direct dev dependency, 8.1.3 | GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm; GHSA-9jrq-w75r-8gcw and GHSA-rq7h-c2jc-7f22; affected through 8.1.5 | Development server/editor/middleware; not the built static production server. Relevant when exposed to untrusted requests.      | Feed offers update; no toolchain upgrade made. Recheck current patch and framework compatibility in a separate change.                 |
| `vitest → @vitest/mocker`, 4.1.11   | GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp, through `<4.1.12`                                                                        | Development mocking server; not production runtime                                                                              | Feed lists Vitest 4.1.12. Not upgraded under the DOMPurify-only dependency scope.                                                      |

The initial full-tree feed reported 2 high, 2 moderate, 1 critical package findings (transitive effects count Vitest separately), rather than the historical two. After the patch, the production-only audit reports **one high, Zod**. Severity labels differ between some upstream advisory pages and npm; no severity was silently downgraded.

## Repository hygiene

`docs/lint-warning-baseline.json` inventories 904 warnings by file/rule/severity with zero errors. `npm run lint:baseline` enforces no increase per inventory entry in CI. No legitimate lint rules were disabled. Temporary local artifacts are ignored by Git and ESLint.

All 34 open PRs were inventoried. Historical feature candidates: #11–18 and #36–57 (excluding nonexistent #41). Current `main` explicitly contains the PR11–18 release (`22633bf`, #19), Waves 1/2 (`231bbc6`) and later Waves through #66. However, merge-tree comparisons of all 29 historical feature heads against current main conflict; squash history and later edits prevent a mechanical no-unique-work proof. They are **left open**, preserving potentially useful changes pending a narrower hunk/function review. Dependency/action PRs #3, #4, #23, #24, #59 also remain open because they contain proposed upgrades outside this task. **No PR was closed and no explanatory closure comment was posted.** Historical Wave 6 checkpoint wording is contextualized with a current-production banner, without rewriting its original evidence.

## Release and rollback

No merge, production publication, production migration, environment change, fixture mutation, real email, provider import, charge, or invoice/credit mutation was triggered in production. Read-only probes returned live health 200 on `078f3f83a456`, production fixtures 403 (“disabled in production”), and unauthenticated provider health 401.

Required candidate gates remain `verify`, `migrations`, `smoke`; the added warning baseline and sixth native concurrency suite are in CI. A draft PR may collect isolated CI while marked NO-GO. A `[skip netlify]` draft intentionally has no deploy candidate and cannot authorize production publication. Before release, remove that hold only after security and independent checks are resolved; obtain the Git-built artifact, inspect its schedules/background modes, verify protected staging and exact commit, review migration/backup state, then request explicit publication authorization. Existing production remains locked.

Rollback: revert the specific remediation/application commits through the protected Git pipeline and retain the additive private receipt schema. Revert dependency-only commit `d23d313` if the authorized patch has an unacceptable regression; rerun security/regression gates and explicitly reassess the vulnerabilities restored by that rollback. Never restore an unrelated historical deployment. After authorized release, obtain three real ten-minute scheduler runs, safe provider review/replay evidence, maintenance stage timings/error rates, fixture denial, public booking and sign-in evidence. Manual HTTP, demo tests and a background 202 are insufficient.
