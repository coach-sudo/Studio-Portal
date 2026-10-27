# October 26 remediation verification matrix

> Historical checkpoint at `6c4b4c7`. For the PR #67 continuation, see [candidate gates](pr-67-candidate-gates.md) and the PR description's exact-head CI/artifact evidence. Later evidence supersedes individual pending rows here; this checkpoint is retained as audit history.

Evidence is local unless the environment column explicitly says production. PASS is limited to the stated evidence. A passed isolated test does not establish a working provider integration or authenticated production journey. Release decision: **NO-GO**.

## Operational acceptance

| Criterion                                                      | Status           | Environment / evidence                                                                                                                              |
| -------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current production commit/deployment                           | PASS             | Netlify API and live health: `078f3f83a456d049b28c287b69d4e4a46c3f6056`, `6ad8e4ee73c3bc97c37dd94f`, locked                                         |
| Current four schedule identities / artifact presence           | PASS             | Published manifest: intake every ten minutes; maintenance/calendar/outbox every five; intake-background distinct background mode; no edge functions |
| Prior 499 failure verified                                     | PASS             | Production: 18/18 intake 499 in 12:00–15:00 UTC; request `01M5WB1KJAQ40KFBQX2DCEWA5B`, scheduler user agent, 14.976 s                               |
| Exact platform cause of 15-second cancellation                 | NOT YET VERIFIED | Public docs specify 30-second scheduled limit; missing completion telemetry is inconclusive                                                         |
| Correct repaired deployed function identity and schedule       | NOT YET VERIFIED | Source preserves names/cadences; no repaired deployed artifact yet                                                                                  |
| Durable dispatch, visible failure, accepted background handoff | PASS             | Isolated dispatch regressions: persist first, bounded awaited 202, transport/non-202 failure retained for retry                                     |
| Background request authorization / deploy binding              | PASS             | HMAC, tampering, unsigned/cross-worker/cross-deploy denial tests; no raw key transmitted                                                            |
| Background error rejection and recoverable work                | PASS             | Isolated safe failure receipt / thrown error tests; pending intent and lease-expiry SQL tests                                                       |
| Successful real scheduled-function invocation                  | NOT YET VERIFIED | Requires controlled publication; manual tests are not scheduler evidence                                                                            |
| Successful hosted background processing                        | BLOCKED          | No safe Google test credentials in staging; no production import invoked                                                                            |
| Three consecutive real scheduled executions at cadence         | NOT YET VERIFIED | Only after explicit publication authorization and all preproduction gates                                                                           |
| Expected safe provider review record creation/update           | PASS             | Synthetic Gmail recovery and Calendar replay regressions persist review records; hosted provider path BLOCKED                                       |
| Replay without duplicate lessons, mappings or reservations     | PASS             | Existing provider/review regressions and native concurrent transaction test; production replay NOT YET VERIFIED                                     |
| Wave 6 identity ambiguity and reschedule-review safeguards     | PASS             | Existing provider classification/recovery/Calendar replay and transactional database tests retained                                                 |
| One failed message/source does not stop unrelated intake       | PASS             | Batch regression persists later safe review, then fails overall run for retry; independent source processing                                        |
| No silent provider persistence failure                         | PASS             | Checked PostgREST errors; safe worker failure and retry path tests                                                                                  |
| No sensitive worker logs                                       | PASS             | Category/message allowlist test rejects private error payloads; no raw provider/student data serialized                                             |
| Prior 499 route pattern stopped in production                  | NOT YET VERIFIED | No repaired release; do not infer from unit/manual success                                                                                          |
| Maintenance 502 defensible cause                               | PASS             | Opaque object throw confirmed; exact failing stage remains unknown and is explicitly documented                                                     |
| Useful maintenance stage/error/duration logging                | PASS             | Shared safe telemetry and stage boundaries; production stage attribution pending release                                                            |
| Maintenance normal wall-clock improvement                      | NOT YET VERIFIED | 100-to-1 ledger-read reduction verified locally; no production after-release latency sample                                                         |
| No unsafe overlap / stale leases / duplicate delivery          | PASS             | PGlite claim/recovery tests and native concurrent PostgreSQL sessions; 20-minute fencing lease                                                      |
| Partial failures retain booking/credit/invoice safeguards      | PASS             | Existing isolated financial/occurrence tests and review transaction replay pass; no production mutation test                                        |

## Authenticated workflows

All production authenticated rows below are **BLOCKED** because approved coach/student/guardian test sessions were not established. No authentication was bypassed or manufactured. Local demo/component coverage and future ephemeral CI are supplementary evidence only.

| Role / workflow                                                           | Status  | Evidence / limitation                                                                                                                             |
| ------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coach dashboard, student selection, switching and refresh                 | BLOCKED | Production identity unavailable                                                                                                                   |
| Coach Today/current work and occurrence context                           | BLOCKED | Production identity unavailable                                                                                                                   |
| Coach Google Meet state and join timing                                   | BLOCKED | Approved identity plus isolated Google integration unavailable                                                                                    |
| Coach packages, reservations, invoices and payer relationships            | BLOCKED | No real financial mutations used for testing                                                                                                      |
| Coach Materials/Library 2.0, assignments and signed downloads             | BLOCKED | Production identity unavailable                                                                                                                   |
| Coach Inbox/provider identity and communication/campaign history          | BLOCKED | No production provider scan or communication sent                                                                                                 |
| Coach actor builder, private preview and publishing                       | BLOCKED | Local editor/renderer tests pass; hosted approval/publish journey not run                                                                         |
| Coach Settings persistence and logout/login return                        | BLOCKED | Local component coverage does not prove production session behavior                                                                               |
| Student correct identity/permissions                                      | BLOCKED | Approved production student identity unavailable                                                                                                  |
| Student upcoming lessons, current work and published notes                | BLOCKED | Actual route is `/portal/bookings`; demo rendering is not authenticated verification                                                              |
| Student assigned materials and signed downloads                           | BLOCKED | Approved production identity unavailable                                                                                                          |
| Student package visibility and join-link availability                     | BLOCKED | No manufactured access or financial fixture mutation                                                                                              |
| Student mobile navigation, Settings and reauthentication                  | BLOCKED | Production session unavailable                                                                                                                    |
| Guardian household association and authorized switching                   | BLOCKED | Approved guardian/household identity unavailable                                                                                                  |
| Guardian billing, lesson/material access                                  | BLOCKED | No real household fixture used                                                                                                                    |
| Guardian denial of unrelated students, coach notes and financial mutation | BLOCKED | Isolated authorization tests retained; authenticated production boundary walk not run                                                             |
| Mobile/tablet/desktop rendering                                           | PASS    | Local computed-style comparisons at 320/768/1440 on booking, coach calendar, login and dark Settings; no claim of complete production walkthrough |
| Keyboard focus trap, restoration and accessible Search names              | PASS    | Four Chromium/WebKit local browser tests, including repeated visits and 320 px header                                                             |
| Relevant axe checks                                                       | PASS    | Local 12-state matrix on supported URLs; final evidence summary records findings; not screen-reader conformance                                   |

## Required quality gates

| Gate                                                           | Status  | Evidence / limitation                                                                                                           |
| -------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Vitest complete current suite                                  | PASS    | Final rerun after shared focus fix: 958 tests across 143 files, zero failures; see evidence summary                             |
| TypeScript                                                     | PASS    | `tsc -b --pretty false`; production-shaped build includes it                                                                    |
| ESLint                                                         | PASS    | Zero errors; 904 warnings inventoried per file/rule/severity                                                                    |
| Non-increasing lint baseline                                   | PASS    | `npm run lint:baseline`; CI step added without disabling rules                                                                  |
| Formatting                                                     | PASS    | Repository format gate plus changed/new file formatting                                                                         |
| Production-shaped build                                        | PASS    | Browser-safe CI Supabase placeholders; query layer false; no production secrets                                                 |
| Bundle budgets / global CSS advisory                           | PASS    | Global CSS 21,923 gzip bytes, down from 24,036; unchanged advisory 22,000 / failure 25,000                                      |
| Migration applied independently                                | PASS    | Additive migration applied to disposable native PostgreSQL; isolated SQL tests pass                                             |
| Migration reset                                                | BLOCKED | Docker I/O error while acquiring configured image, then read-only filesystem; WSL subsequently failed to start                  |
| Schema lint                                                    | BLOCKED | Reset failure prevented fresh-stack lint; new private schema included in CI lint scope                                          |
| Generated database types                                       | PASS    | Generated from isolated native DB; only three public RPC additions; fresh reset/type diff still required in CI                  |
| Full pgTAP                                                     | BLOCKED | Local stack failure; new permission/RLS pgTAP assertions committed for CI                                                       |
| Credit, lesson-change, lesson-bulk, material-study concurrency | BLOCKED | Four existing full-stack suites could not run after WSL failure                                                                 |
| Provider-intake concurrency                                    | PASS    | Native isolated sessions: one student, lesson, audit and receipt; second-key replay refused; cleanup passed                     |
| New scheduled-worker concurrency                               | PASS    | Native sessions: one claim, expiry recovery, stale finish denial, failed retry, no completed replay; cleanup passed             |
| Complete connected Playwright matrix                           | BLOCKED | Local backend unavailable; candidate CI must run it; four focused demo tests are not substituted                                |
| Complete connected axe matrix                                  | BLOCKED | Requires full ephemeral/approved hosted stack; local page checks recorded separately                                            |
| Fixture cleanup                                                | PASS    | Native provider/worker fixtures cleaned; complete browser fixture cleanup BLOCKED with connected matrix                         |
| Secret scanning                                                | PASS    | Repository scanner; no provider/service secrets written into tracked artifacts                                                  |
| Production dependency audit                                    | FAIL    | One high Zod advisory remains after DOMPurify patch; no audit suppression                                                       |
| Focused provider-intake regressions                            | PASS    | Parser/classification/recovery/Calendar replay plus worker dispatch tests                                                       |
| Focused maintenance regressions                                | PASS    | Lease/recovery, checked queries/all-settled lease retention, paginated ledgers/notes and renewal-pricing coverage               |
| DOMPurify / actor regressions                                  | PASS    | Fifteen sanitizer cases; exact provider allowlists, inert preview/public text and existing builder test; hosted journey BLOCKED |
| Stripe browser checkout                                        | BLOCKED | Actual checkout journey not executed; no live payments attempted                                                                |
| Production fixture protections                                 | PASS    | Read-only live GET 403 and production-context denial unit tests; no production setup/mutation probe                             |
| Protected provider health                                      | PASS    | Read-only unauthenticated production GET 401                                                                                    |

## Repository and release gates

| Gate                                                                                                        | Status           | Evidence / limitation                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Isolated DOMPurify rollback commit                                                                          | PASS             | `d23d313`, manifest/lockfile only, user-authorized 3.4.17                                                                           |
| Historical PR inventory and unique-work review                                                              | PASS             | 34 inventoried; 29 feature heads compared; conflicts documented rather than discarded                                               |
| Safe obsolete PR closures                                                                                   | NOT YET VERIFIED | None closed: mechanical comparisons were inconclusive; five dependency/action PRs deliberately preserved                            |
| Current production status understandable                                                                    | PASS             | Audit report and banner contextualize historical Wave 6 checkpoint                                                                  |
| Correct candidate CI attachment                                                                             | NOT YET VERIFIED | Must inspect checks for the final draft head; no inherited-check claim                                                              |
| Exact deploy artifact identity/provenance                                                                   | NOT YET VERIFIED | Draft intentionally held from Netlify; no deployment candidate approved                                                             |
| Backward-compatible migration and rollback plan                                                             | PASS             | Additive private state, retained on app rollback; migration not applied to production                                               |
| Existing production lock and Git-derived release policy                                                     | NOT YET VERIFIED | Current lock confirmed; full current Git-only build settings not exposed by available project tool; must recheck before release     |
| No unauthorized production mutations                                                                        | PASS             | Only read-only health/config/telemetry/schema/statistics queries and GET probes; no worker, import, payment, email or fixture setup |
| Post-publication health, three scheduler runs, review/replay, maintenance telemetry, public booking/sign-in | NOT YET VERIFIED | No publication occurred or was authorized                                                                                           |

Do not merge or publish this candidate while any required gate above is FAIL, BLOCKED or NOT YET VERIFIED. Resolve the security advisory and independent CI first; establish safe provider/test identities and a reviewed artifact before requesting controlled publication.
