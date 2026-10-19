# Wave 1 staging release candidate and browser acceptance

October 17, 2026 (Eastern). **Preparation only. Production remains NO-GO.** No deployment, publication, merge, Auth change, hosted business mutation, provider operation or worker invocation is authorized by this checkpoint.

## Candidate and dependency

Application candidate: **`830c762bdaf085f5e20a91f4e6a7afbef4afa627`**. The delivery branch is `codex/wave-one-staging-release-candidate`, directly based on PR #49, `codex/wave-one-hosted-execution-checkpoint`, at **`025fe0fd6efde25cf14a77ef77c330909224946d`**. Later report, acceptance-helper and proposal-tooling commits on this branch are delivery checkpoints, not application deployment pins. They do not change the application runtime. The final helper checkpoint additionally rejects credential-bearing read URLs, waits for the actual forged-route redirect, uses the schema's `virtual` lesson location, and raises proposal-only lesson limits to permit a real second UI page. Focused checks revalidate these changes separately.

[Fresh infrastructure and PR evidence](wave-one-release-infrastructure.json) records all heads and ancestry. PRs #36, #37, #38, #39, #40 and #42 contain the six Wave 1 implementations; #43 is integrated acceptance, #45 staging recovery, #46 deployment preparation, #47 hosted read-only acceptance/UI fixes, #48 the reviewed executor, and #49 its completed execution evidence. All remained open drafts. Every inspected head is an ancestor of this candidate; no old stacked PR or PR #28 was imported.

The candidate includes both PR #47 fixes unchanged: search autofocus/trapped focus/opener restoration and the 320 px student identity layout. Relative to deployed `0b18a5a2238daa49bec1290f5884d5792f4aefc9`, the only additional application change is legacy query-cache invalidation after commands. Test, documentation and local preparation helpers do not enter ordinary client bundles. No function runtime source, Netlify configuration, dependency lockfile, generated database types or migration changed.

The mode comparison exposed a real defect: `invalidateStudioDomains` refreshed V2 queries and financial summaries but omitted `studio-legacy`. Legacy screens could therefore show pre-command lesson/financial data until polling or navigation. It now invalidates legacy snapshots too. Six integration cases verify coach/student/guardian refresh in both modes. This changes refresh timing, not authorization or financial policy.

Review map: `src/hooks/useStudio.ts` and its route integration tests contain the refresh repair. `playwright.candidate.config.ts` and `e2e/candidate-local/` contain loopback acceptance; `e2e/support/candidateTarget.ts`, `hostedReadOnly.ts`, and `src/security/candidateAcceptance*` provide the separately gated future read-only target. Staging helpers extend the historical Linux/Auth verifiers without replacing their default pins, replay the candidate's identical migration tree, coordinate native concurrency, and independently read the completed baseline. `prepare-ui-mutation-plan.mjs` and its tests generate the proposal only. The remaining files are sanitized evidence/reports and TypeScript inclusion of the new test configuration. No secret, screenshot, browser session, build zip or database dump is committed.

## Preserved staging state

| Target                            | Verified state                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Netlify                           | `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`, all-deploy team login, builds stopped, no build hooks/active builds/shared variables                            |
| Existing protected draft          | `6ad23d4f8b10c10447224155`, ready, `deploy-preview`, unpublished                                                                                        |
| Existing application              | `0b18a5a2238daa49bec1290f5884d5792f4aefc9`, unchanged                                                                                                   |
| Existing published staging deploy | `6ace53e7f850061d7c49b711`, unchanged                                                                                                                   |
| Supabase                          | `lrxrivfqjpkvygozphoz`; TLS and hostname verification retained                                                                                          |
| Synthetic studio                  | `4ceff683-e72f-4b2e-96ce-85db2dca4eb2`                                                                                                                  |
| Environment                       | Exactly ten preview-only variables; server URL, studio IDs and public keys match staging; V2 flag remains `true`; service/fixture secrets function-only |
| Providers                         | No Stripe, Google or Gmail credential names; shared-team variables empty                                                                                |

[Read-only database verification](wave-one-release-baseline.json) proves 57 installed migrations, accepted schema seal `24828e13e95714c1c42a0734fc6a6dfcb63f33a2947734cdcdbeee751efca3f4`, all 37 original business rows and all retained rows unchanged across 76 tables, 215 rows total. The verifier imports no executor and makes no claims, writes or journal changes. It checks the completed journal's chain and compares its original baseline plus retained-owned snapshots with current rows in one read-only repeatable-read transaction.

The completed H01–H16 run remains **16/16 PASS**, 68/100 canonical requests, cleanup PASS. Its original receipt is exhausted regardless of its timestamp. Do not restart it or reuse its run ID, accounts, receipt or journal. The two disabled students, banned coach identity, audit/replay evidence, and original manual-test accounts remain intact. The new UI run is a separate proposal.

## Validation evidence

Final results are recorded in [the machine-readable validation report](wave-one-release-validation.json). **815 unit/integration tests passed across 117 files; both browser matrices passed 65/65, with a further 13/13 desktop checks in each mode after final helper review.** Fresh native PostgreSQL passed all 57 migrations, 204 pgTAP assertions and three concurrency suites with observed lock contention. Four Chromium/WebKit focus checks, eight Node helper tests, 88 focused guard/mode/origin tests and 18 focused release/origin checks passed; these counts overlap the full unit suite and are not added into a unique-test total. Both Linux query-mode builds and official offline Netlify packaging passed. Private logs, screenshots, local fake sessions and browser JSON remain under `C:/Users/dariu/.codex/private/studio-portal-staging/release-candidate-20261017/`; credentials are never included in committed evidence.

The full suite includes unit/integration tests, typecheck, lint, formatting, secret scanning, origin/release tests, helper tests, both-mode builds/budgets, fresh PostgreSQL replay/pgTAP, actual concurrent PostgreSQL sessions, and Chromium/WebKit focus/browser checks. See the validation report for executed counts and failures; do not infer success from this inventory.

Two test infrastructure problems were investigated before the final pin:

- Parallel workload exposed one-second lazy-route test timing and short native holder sleeps. The serial unit run passes without changing application expectations. The native transport now replaces only the test holder's timing sleep with an advisory coordinator barrier, released after the original `pg_stat_activity` assertion observes the racing session on a real financial/record lock. Financial commands and outcome assertions remain the original Git scenario bodies. Missing contention still fails; the barrier does not synthesize success.
- The new browser fixture initially omitted the required contact relationship type and attempted storage initialization inside axe's opaque sandbox frames. The fixture now uses schema-compatible rows and initializes synthetic sessions only in the top-level loopback application. Page errors are asserted separately from axe findings. These were fixture defects, not production fixes.

## Browser coverage and query-mode meaning

`playwright.candidate.config.ts` requires an explicit mode and starts the real Vite application with demo mode disabled and Supabase configured exclusively at `http://127.0.0.1:54399`. All auth/REST/RPC/API requests are intercepted by deterministic in-memory fixtures; off-loopback requests and WebSockets are rejected. These tests exercise the real AuthGate, role routing, repository mappers, query hooks, command envelopes, forms, dialogs and rendering. They **do not** prove hosted RLS, transactional HTTP execution, real Supabase Auth, Netlify perimeter expiry, or provider delivery.

The 13 cases run in desktop Chromium (1440), tablet (768), mobile (390), narrow mobile (320), and desktop WebKit, separately for `true` and `false`:

- Coach Overview, Household, Payments, bounded lesson selection, Today, exact lesson links, refresh, financial labels, account-credit reads and header width.
- Student and guardian Home, Schedule, Payments, Settings, exact lesson detail, financial control restrictions and refreshed identity.
- Search autofocus, repeated Tab containment, Escape/opener restoration, bulk selection and reason/scope form.
- Local-only lesson creation/editing, reviewed bulk confirmation/results, stale response handling and stable replay keys; provider-capable reschedule conflict-check failure leaves the existing lesson intact.
- Summary loading, failure hiding stale values, retry/empty state, unrelated identity, forged student context, and relationship revocation followed by direct-route denial.
- Overflow and serious/critical axe checks on all representative role routes; private screenshots and all axe findings are retained.

V2 must produce `studio_route_snapshot` requests; legacy must produce direct `lesson_list_rows` reads and no route-snapshot RPC. Summary/coverage RPCs remain authoritative in both modes. V2 retains bounded roster reads and route-specific aggregation; legacy retains its broad RLS-backed snapshot. Those transport/performance differences are intentional. Matching fixture-visible results do not establish equal large-data scalability or server-side authorization: fresh pgTAP and prior H acceptance cover the latter separately.

`playwright.hosted-readonly.config.ts` reuses PR #47's protected-browser infrastructure. Its historical target remains the default. A future target requires a private `HOSTED_CANDIDATE_MANIFEST_FILE`, separate read-only approval, exact new immutable origin/site/project/studio/manual student and candidate SHA, plus a matching health release marker. No deployment ID is invented here. Business writes remain blocked, including direct workers, fixture endpoints, provider-capable health and rescheduling. Three bounded lesson read wrappers can be assessed as read-only; the candidate lane permits them without permitting preview/execution writes. Existing manual accounts remain for non-mutating checks only.

Hosted HTTP/browser mutations, multi-tab revocation without navigation, real server-side command errors/partial-response recovery, large fixtures, 200% zoom/manual accessibility, isolated providers and scheduled cadence remain acceptance gates. A local stale-response simulation is not a hosted stale-review proof. Local rendering does not establish human usability approval.

The initial matrices report two **moderate** `landmark-unique` findings per mode on coach Overview (desktop Chromium and WebKit), targeting the sidebar alongside the unlabeled contextual aside. These remain an accessibility follow-up; zero serious/critical findings does not mean zero findings or completed manual accessibility acceptance. Netlify's service secret is opaque/write-only: its function/preview scope is verified, but effective authenticated HTTP credential acceptance remains a separately gated hosted read check.

## Endpoint safety and new UI mutation scope

[The endpoint assessment and independent proposal](wave-one-ui-browser-mutation-proposal.md) covers all 23 function entry points and relevant command variants. [The deterministic manifest](wave-one-ui-mutation-proposal.json) defines the new run `e2e-wave1-ui-20261017-a`, four fresh accounts, two students, twelve seeded lessons plus one UI-created lesson, one four-credit lot, zero cash/checkout/payment operations, and hard request/row caps. It does not authorize or implement hosted fixture creation.

Known remaining wrapper gaps:

1. Rescheduling and `check_conflicts` can call Google before the SQL operation. They remain prohibited in the hosted provider-free lane, even when provider credentials are absent. H06's SQL proof is preserved and does not become an HTTP claim.
2. `lessons:create` uses a random idempotency envelope but the handler does not pass it to `command_create_lesson`; its audit write is separate. UI creation therefore permits one submission only in the proposal. A lost response or post-create audit failure must stop for exact-ID/journal inspection; no automatic create retry or claim of exactly-once creation.
3. Profile/contact updates include multiple writes/audit and may queue calendar projections. The proposal requires payload-specific ownership guards and independently reviewed recovery before hosted use. Invitation, login-instruction and credential-provisioning branches can dispatch outbox messages and remain prohibited.

These do not prevent a protected read-only candidate deployment. They prevent claiming complete hosted mutation/provider acceptance.

## Linux artifact and deployment procedure

Sanitized identities: [V2 Linux package](wave-one-release-linux-v2.json), [legacy Linux package](wave-one-release-linux-legacy.json), and [official offline CLI build](wave-one-release-netlify-build.json). Each names the exact candidate, lockfile, runtime, client assets, functions, routes, schedules and hashes. Linux x64 Node 22, lockfile installation, Sharp/libvips ELF and font checks, local render, and invoice module import/GET with fetch disabled are required. Windows native artifacts are excluded. The primary and alternate build trees are separate.

This preparation does not upload artifacts. The eventual supported action is the integrated Netlify CLI 27.8.0 build and immutable draft upload, which creates a fresh manifest immediately before upload. Do not upload today's expired function cache or use `--no-build` with `--context`, pre-zipped functions without routing metadata, an alias, `--prod`, a push/merge to main, or `restoreSiteDeploy`.

After separate authorization:

1. Reverify draft PR heads, exact candidate Git SHA/clean Linux checkout, Node 22, lockfile/hash, staging site ID, all-deploy team login, build freeze, zero active builds/hooks, expected preview-only configuration, no shared/provider/production-context credentials, and unchanged old publication. Repeat staging schema/baseline read-only checks. Stop on drift.
2. Use the reviewed Linux checkout and supported CLI authentication. Reinstall from the lockfile if dependencies changed; verify Sharp Linux artifacts. Preview build values must match staging and `VITE_QUERY_LAYER_V2=true`. Credentials remain function-only and must not enter shell logs or public build values.
3. Set `COMMIT_REF` from verified `git rev-parse HEAD`. Let Netlify derive `CONTEXT`, `URL`, `DEPLOY_URL` and `DEPLOY_PRIME_URL`; never inject fabricated immutable URLs or untrusted request headers. The release helper must emit `deploy-preview` and the candidate's first 12 characters.
4. Execute exactly once, on Linux, using the existing CLI 27.8.0:

   ```text
   netlify deploy --draft --context deploy-preview --site d83ff6cb-f57b-4741-8c3c-3eaae7adab19 --message "Wave 1 reviewed 830c762bdaf085f5e20a91f4e6a7afbef4afa627" --json
   ```

5. Retain the actual deploy receipt privately. Verify returned site/context, ready state, `published_at=null`, immutable permalink, function identities/runtime and unchanged published deploy. Through normal team login verify an unauthenticated request remains gated and a protected `/api/healthz` read reports the correct release. Verify trusted `DEPLOY_URL` equals the returned immutable origin; do not invent a deploy ID to pass a check. No worker or business route is called.
6. Stop. New-host Auth configuration and hosted role logins/mutations require their own authorization. If upload/verification fails, leave the old draft/publication and Auth settings untouched. Do not retry an ambiguous upload automatically: inspect its actual deploy list/receipt first. Fix forward with a newly reviewed pin if source must change.

Unpublished draft schedules do not activate. The four old published timers remain declared; PR #46 records their frozen snapshot failing before Supabase access. This is containment evidence, not permanent deactivation. Recheck current configuration/log evidence before deployment; never invoke them to test. Do not fill production-context values or publish staging. A timer's presence is not provider acceptance.

## Exact-host Auth follow-up

Auth remains configured to `https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app`. No current URL or allowlist changed. A new returned immutable origin will require a separately approved minimal update:

- Site URL: the **actual returned** immutable origin.
- Redirects: that origin plus `/auth/callback` and `/auth/callback\?**`; the backslash makes the query delimiter literal in Supabase's supported glob syntax. No host wildcard, arbitrary preview, production or localhost redirect.

`prepare-auth-config.mjs` now accepts an explicit full expected candidate after its existing two arguments; it still defaults to the historical pin. Feed a sanitized actual deploy receipt with verified source/health identity. The helper only writes an external minimal TOML containing the two Auth URL properties; it never pushes. After separate approval, inspect current remote config, use CLI diff, require only those properties, then apply/read back. Stop if unrelated changes cannot be excluded. Preserve SMTP, OAuth, hooks and all unrelated defaults. Do not run invitations, resets, OTP, fixture or provider operations.

Only after approved target/Auth setup: create a new private Owner/SYSTEM acceptance directory, complete normal Netlify team login at the actual host, capture exact-host secure perimeter cookies with `protected-browser.mjs`, and verify the health pin. Then separately authorized read-only role checks may use the four existing confirmed synthetic accounts. Do not copy dashboard sessions or existing app sessions across hosts, expose passwords, or change original accounts.

## Next authorization boundary

The requested next action is **one protected, unpublished `deploy-preview` draft** of candidate **`830c762bdaf085f5e20a91f4e6a7afbef4afa627`**, V2 enabled, on staging site **`d83ff6cb-f57b-4741-8c3c-3eaae7adab19`**, using the verified Linux/Node 22 integrated CLI build/deploy path, followed only by deploy metadata, access-protection and protected health verification. Preserve the old publication, Auth URLs, database and successful H evidence.

**Recommendation: GO for that one protected, unpublished staging draft after explicit authorization and fresh preflight; NO-GO for production or hosted business mutations.** That authorization would not include Auth updates, application role logins, hosted fixtures/financial commands, providers, messages, workers, merges, production or Wave 2. Those remain separately gated.
