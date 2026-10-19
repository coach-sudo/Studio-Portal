# Wave 1 protected hosted acceptance — October 16, 2026

**Production remains NO-GO.** Seventy distinct hosted checks produced **68 passes and two confirmed presentation/keyboard failures**. Both fixes pass locally and remain undeployed. The final full suite passed **784 tests / 116 files**, disposable PostgreSQL passed **204 assertions and three concurrency programs**, and four local Chromium/WebKit checks passed. This checkpoint does not approve hosted business mutations, providers, workers, deployment, publication, merges or Wave 2.

## Identity and dependency chain

The application tested is `0b18a5a2238daa49bec1290f5884d5792f4aefc9`, at [the protected immutable draft](https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app). Netlify site is `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`; Supabase is `lrxrivfqjpkvygozphoz`; studio is `4ceff683-e72f-4b2e-96ce-85db2dca4eb2`. The new test branch is directly based on PR #46 head `451e409e1726ddd50722591c68f2bc3faf7789b1`. Test changes do not change the deployed application pin.

Fresh inspection found the draft ready, `deploy-preview`, unpublished, with all-deploy team login. All 57 staging migrations remain installed; none was replayed there. Ten staging variables remain scoped to deploy-preview, service credentials function-only, with no Stripe/Google/Gmail credentials. Production was excluded from all infrastructure and browser requests.

| PR  | Verified head                              | Direct base                            |
| --- | ------------------------------------------ | -------------------------------------- |
| #36 | `f99f8cc0b7ae209e27562014e0743f39052f1dad` | `main`                                 |
| #37 | `0badcc648ec715e20c2be7849d0bdbd8ec0955e0` | `codex/credit-coverage-diagnostics`    |
| #38 | `c894f7f51f26aae0e9c396a4d791d2bbc0c1a545` | `codex/credit-lifecycle-reliability`   |
| #39 | `8b8a0aa173bfbc03f0bdb01a3a8953459f86cd0f` | `codex/occurrence-safe-lesson-changes` |
| #40 | `c162fc292d4b9ba8d78c9ae2eb4c0c08485119ee` | `codex/bulk-lesson-management`         |
| #42 | `2470adf349cbf3995e375bd9c69a12b4945eb204` | `codex/bulk-lesson-interface`          |
| #43 | `fe63c57e928bca78c23e43877480b36a2d8e26c6` | `codex/student-workspace-experience`   |
| #44 | `5be0de2a8a2dc3563ceac80f1a197f75cba24bb4` | `codex/wave-one-integrated-acceptance` |
| #45 | `04768d281b0eca3a2c146dbf35d153b6b6301e77` | `codex/wave-one-staging-proposal`      |
| #46 | `451e409e1726ddd50722591c68f2bc3faf7789b1` | `codex/wave-one-staging-configuration` |

All were open drafts at inspection. The master plan, [integrated acceptance](wave-one-integrated-acceptance.md), [recovery](wave-one-staging-recovery.md), [draft deployment](wave-one-staging-draft-deployment.md), and [Auth checkpoint](wave-one-staging-auth-configuration.md) retain their historical evidence and approval boundaries.

## Guarded browser implementation

`playwright.hosted-readonly.config.ts` has no fixture setup/teardown, deployment or server-start hook. It uses existing synthetic identities only. Each browser and API request context receives exact-host Netlify perimeter cookies; unrelated dashboard cookies and application localStorage are discarded during capture. Each application role receives its own staging Auth localStorage, validated against its expected Auth identity.

The user completed normal Netlify login in the capture browser. No access control was bypassed. State, credentials, screenshots, reporter output and artifacts stay outside Git under an Owner/SYSTEM-only Windows directory. Traces/video/automatic failure screenshots are disabled. Explicit screenshots are taken after sign-in, with password fields masked. Header, body and query values are never retained by the request guard. The browser helper's cookie/domain/expiry and private-path tests also run locally.

Every test first checks protected `/api/healthz` for the exact shortened application SHA and `deploy-preview`. The lane requires the exact origin plus `HOSTED_READ_ONLY=true`; changed targets, unavailable sessions and unexpected requests fail closed. API calls use the same browser context's request context, an explicit method/endpoint allowlist and `maxRedirects: 0`. Browser requests to production, external providers, mutations, arbitrary RPCs, workers and encoded endpoint bypasses are blocked before transmission; WebSockets and service workers are disabled.

The legacy fixture setup/teardown now rejects non-loopback targets. It cannot accidentally create/delete hosted fixtures through the read-only command. Dedicated read-only and local-focus directories are excluded from the legacy configuration; `playwright test --list` still discovers its 62 existing checks across 18 files without loading hosted credentials. Future approved hosted mutations need their own reviewed executor and perimeter handling; setting a fixture secret alone does not unlock them.

Two automatic application requests are deliberately prevented and recorded as **blocked boundaries**, never represented as tested endpoints:

- `GET /api/v2/health` from coach Bookings/Settings can call Stripe/Google and exchange credentials. It stays blocked even though providers are currently absent. Basic navigation is tested; provider-health behavior is not.
- A portal user entering a coach route is denied and redirected to `/`; that router then attempts `POST /api/v2/auth/claim-access`. The claim is blocked. No coach workspace is shown; completion of that access-claim redirect is not claimed.

The ordinary password login handler updates Auth sessions/rate-limit counters. Its existing verified-email claim code has no unlinked synthetic membership/contact to claim. Before/after fingerprints cover every business table to detect any unintended record change. These operational Auth changes are within the user's sign-in authorization.

## Executed verification

The [machine-readable result](wave-one-hosted-acceptance.json) accompanies this report. Primary hosted matrix: **69 executed, 68 passed, 1 failed, 0 skipped**. The additional 320 px header check failed, making **70 distinct checks: 68 passed, 2 failed**. A targeted identity/keyboard recheck produced 3 passes and the same failure; those repeats are not added to the distinct count. Intermediate harness calibration had 39 passes, 20 failures and 1 skip before corrections; it is retained privately and not represented as 20 application defects.

The final local full run passed **784/784 tests in 116 files**, including the request-policy regressions. The final loopback demo browser run passed **4/4** checks (search focus and 320 px header, Chromium/WebKit). Six helper tests and the 16-test dialog/calendar regression subset also passed; these overlapping subsets are not added to the full unit count.

All **76 business tables have unchanged counts and deterministic row hashes**: [before/after verification](wave-one-hosted-business-verification.json). Readback still found the same ready unpublished draft, all-deploy protection, stopped builds, old published deploy `6ace53e7f850061d7c49b711`, no shared team variables, ten preview-only site variables and 57 migrations. Read-only Auth diff against the approved exact-host config found 0 updates, 0 local-only and 9 unrelated remote-only entries. No Auth settings were changed.

Quality gates passed: typecheck/build; lint (0 errors, 756 warnings); secret scan; formatting; bundle hard budgets. Largest ordinary JS: 111,672 gzip bytes; CSS: 23,108 gzip bytes, retaining the existing 22 KB warning below the 25 KB failure gate. Browser engines: Chromium 153.0.8010.12 and WebKit 26.6 through Playwright 1.63.0 on Windows x64.

Forty-five settled page audits had **zero serious/critical axe findings and no page-level horizontal overflow**. Manual screenshot review nevertheless caught HA08 below; an automated overflow score alone does not prove readability.

| Lane                        | Scope and result                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Disposable PostgreSQL 17.10 | All 57 original migrations on a fresh loopback-only cluster; **204 pgTAP assertions passed across eight files**                                                    |
| Actual concurrent sessions  | All three original scenario programs passed: financial grant/replay, occurrence/credit/calendar contention, and bulk deletion/replay/reference/identity contention |
| CRLF recovery regression    | Original failure reproduced locally; exact normalization, catalog drift rejection, repeat no-op and concurrent-writer recovery checks passed                       |
| Full unit/integration       | Final counts recorded in companion evidence JSON                                                                                                                   |
| Helper security             | Six Node assertions passed for exact-host Auth configuration preparation and private perimeter handling                                                            |
| Hosted browser              | Final counts, projects and accessibility results recorded in companion evidence JSON                                                                               |

The disposable runner intentionally reads migration/test source from #43 `fe63c57…`. `git diff --exit-code fe63c57… 0b18a5… -- supabase scripts/test-credit-concurrency.mjs scripts/test-lesson-change-concurrency.mjs scripts/test-lesson-bulk-concurrency.mjs` passed: those inputs are identical to the deployed candidate. The native runner's local Auth/storage stubs and adapted connection transport are not a complete hosted Supabase emulator. The actual transaction/race bodies run against PostgreSQL, with observed contention; PGlite alone is not the locking evidence.

SQL files: `credit_coverage` (36), `credit_lifecycle` (28), `lesson_bulk_management` (35), `lesson_occurrence_safety` (21), `lesson_operations_security` (32), `route_snapshot_rls` (15), `schema_smoke` (3), `student_workspace` (34). Transactions roll back fixture writes; the disposable cluster stops afterward. No staging schema or migration state changes.

### Functional coverage and limits

- **Coach:** password sign-in/identity, refresh, Home, Today, Bookings, roster, Inbox, Library, Payments, Settings, exact student Overview/Household/Payments/Lessons/Work/Notes, keyboard dialog behavior.
- **Student:** sign-in/identity/refresh, Home, Work, Schedule, Inbox, Payments, Settings, Actor Page and Referrals; coach workspace denial. No hosted message was marked read or sent.
- **Guardian:** own separate sign-in/identity/refresh, authorized selected student's Home/Work/Schedule/Inbox/Payments/Settings, financial and credit diagnostic reads, logout and preserved Netlify perimeter.
- **Financial reads:** all three roles receive authorized financial overview/coverage for the synthetic student. Persisted zero invoices/lots/ledger/lessons establish genuine zero state. Financial mutations, nonzero hosted consistency, pending invoices and populated history are blocked pending approval.
- **Authorization:** unrelated Auth user is valid but portal login is forbidden; unrelated student/contact/relationship/ledger/note lists return no rows; forged student financial reads and coach summaries are denied; private credit schema is unavailable. Anonymous finance and invoice reads are denied. No raw response bodies with tokens are stored in evidence.
- **Credits and lessons locally:** migration-backed tests exercise grants/assignment replay, newly-applied counts, recurring conversion, cancelled credit reuse, expiry/reschedule, completion without double debit, mixed settings/payment locks, group ownership and coverage recovery. PostgreSQL concurrency proves serialization in the exercised races. Stripe/Gift/renewal provider integration is not proven without isolated credentials.
- **Bulk locally:** physical deletion/scaffolding and retained audit, dependency fingerprints including JSON/arrays, all-matching frozen IDs/exclusions/cap, archive/restore/void, shared occurrence/class protections, stale reviews, job replay/leases/failure recovery and tombstone/identity reuse. Hosted `preview_bulk` persists a review and is therefore blocked, despite its name.
- **Presentation:** screenshots and axe checks cover 320, 390, 768 and 1440 CSS px, Chromium and representative WebKit 1440 flows. The 720 CSS px reflow check approximates 200% desktop zoom; it is not a native browser zoom or assistive-technology certification. Populated lists, long authored content, mobile keyboard, live revocation and record drawers need approved fixtures. Touch-target and text-density observations are reported separately from automated failures.

## Issue register and disposition

| ID   | Severity/type             | Reproduction and evidence                                                                                                                                                    | Disposition                                                                                                                    |
| ---- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| HA01 | Test safety               | Old global setup/teardown can POST fixture setup/cleanup to a supplied hosted base URL.                                                                                      | Fixed locally: loopback-only guard and separate non-mutating lane. No app redeploy needed.                                     |
| HA02 | Harness compatibility     | Initial strict lane blocked `GET /api/invoices`, preventing accurate settled payment screens. Source confirms endpoint only reads caller-visible invoices/delivery metadata. | Fixed locally by allowing GET only; financial commands remain denied.                                                          |
| HA03 | Harness contract          | Coach summary denial was asserted as HTTP 401/403; current SQL raises `P0001: FORBIDDEN`, which PostgREST maps to 400.                                                       | Assert exact code/message and no identity disclosure. No RLS relaxation or schema change.                                      |
| HA04 | Blocked provider boundary | Open coach Bookings/Settings: app automatically requests provider-capable `/api/v2/health`.                                                                                  | Kept blocked. Provider acceptance needs its own authorization/credentials; shell navigation does not prove integration health. |
| HA05 | Blocked mutation boundary | Enter coach URL as student: router denies coach shell, then root tries `claim-access`.                                                                                       | Claim was never sent. Redirect completion is pending an approved mutation-capable Auth check.                                  |
| HA06 | Intermittent local test   | First full unit run: 746/747, public demo booking test timed out waiting for Google Meet while lazy app skeleton remained. Focused rerun: all three booking tests passed.    | Preserve initial failure and final rerun result; no unsupported app fix or widened timeout.                                    |

### Confirmed application defects, fixed locally only

**HA07 — P2, search keyboard focus.** Open coach search: focus lands on Close instead of the autofocus search input. After tabbing and Escape, focus is not restored to the opener. This reproduced twice on the protected application and in a new local component regression. The shared overlay now preserves child autofocus (including Strict Mode effect replay), captures the opener before autofocus, and preserves commit-time focus handoffs between calendar overlays. Search buttons explicitly take focus before opening so WebKit pointer behavior also restores correctly. Existing calendar tests caught a handoff regression in the first local attempt; the corrected implementation passes all 784 tests. Repeated open/Tab/Escape/restore passes in both local browsers. **The deployed pin still contains the bug.**

**HA08 — P2, student header at 320 px.** Open the synthetic student's Household at 320 px. Avatar, name and status remain on a flex row despite a two-column grid rule; the name column is only **87.45 px**, breaking “Staging” and “Student” across individual syllables/letters. A hosted geometry regression and screenshot confirm it. The existing ≤420 px rule now actually sets `display: grid`, sizes the avatar to its 52 px track, and puts status on the next row. The local long-name presentation fixture has a ≥140 px text column and passes in Chromium/WebKit; screenshot reviewed. This is a six-line responsive repair, without a redesign. **The deployed pin still contains the bug.**

The only application changes are these focused fixes in `Primitives.tsx`, `AppShell.tsx` and `cohesion.css`; all other changes are harness/evidence/documentation. No database, financial policy or integration behavior changes. Both fixes require review and separately authorized staging deployment before hosted acceptance can pass them. No new application deployment candidate is approved by this PR.

## Prepared hosted mutation package — not executed

`scripts/staging/prepare-hosted-mutation-plan.mjs` is an offline-only generator: no network imports, credentials, worker calls or execution switch. It produces deterministic UUIDs for `e2e-wave1-hosted-20261016-a`, 16 specific cases, expected effects, budgets, preflight gates and cleanup/recovery steps. See [the proposal](wave-one-hosted-mutation-proposal.md). The generated copy is private; all non-secret plan inputs are reviewable in source.

Approval must expressly cover new run-owned Auth accounts/records, financial command simulations, durable bulk review/execution, service-only per-item processing, negative/revocation checks and scoped cleanup with retained audit. Existing synthetic login identities remain unchanged. A narrowly scoped seed/cleanup executor must be reviewed before mutation execution; the old broad suite must not be run against this draft. No schema fault injection is proposed on staging.

## Reproduction and remaining gates

Use an existing private Owner/SYSTEM-only directory outside this checkout. Capture a normal team session using `scripts/staging/protected-browser.mjs capture EXACT_ORIGIN ABSOLUTE_PRIVATE_DIRECTORY/perimeter.json`; do not supply credentials on a command line. Set `STAGING_BASE_URL`, `HOSTED_READ_ONLY=true`, `HOSTED_ACCEPTANCE_DIRECTORY`, and `HOSTED_CREDENTIALS_FILE` to the existing restricted synthetic credential file. Run `npx playwright test --config playwright.hosted-readonly.config.ts`.

For a rerun, `HOSTED_REUSE_SESSIONS=true` verifies saved Auth identities and perimeter health before testing. A successful logout invalidates that role's session; explicit `HOSTED_REAUTH_ROLE=guardian` permits password reauthentication of only that existing identity. It does not reset/create an account or send email. Do not copy the private output directory into a PR or public artifact upload.

Before production can be considered: review this evidence and any reproducible findings; approve and execute bounded hosted mutations and cleanup; exercise the legacy query flag in a separately approved protected build (only `true` is currently deployed); complete isolated-provider and recovery acceptance; review migration/type/CI evidence and release package; obtain explicit production authorizations. No release approval is implied by passing read-only tests. The six-wave master plan and PR 1.4 → 1.5 → 1.6 sequence remain intact; Wave 2 is not started.
