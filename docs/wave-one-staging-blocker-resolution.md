# Wave 1 staging blocker resolution — PR #46

October 16, 2026 (Eastern). **GO to request authorization for one protected, unpublished staging draft; do not execute it yet. Production remains NO-GO.** This is the current checkpoint after the [first deployment gate](wave-one-first-staging-deployment.md). It supersedes that report's missing-Linux blocker, legacy-worker evidence limit, and proposed upload command. It does not authorize deployment, containment, Auth changes or browser mutations.

## Identity and dependency checkpoint

The application candidate remains **`0b18a5a2238daa49bec1290f5884d5792f4aefc9`**. The previously reviewed PR #46 head is **`65ef33366fef8025a9d62671524801b8510fa1d7`**. They are intentionally different. This checkpoint adds only documentation and local preparation tools; `src`, `netlify`, dependencies, lockfile and migrations remain identical to the application pin. Deploy the application pin, not a later helper/documentation head.

PR #46 remains a draft on `codex/wave-one-first-deployment-gate`, directly based on `codex/wave-one-staging-configuration` / PR #45 at `04768d281b0eca3a2c146dbf35d153b6b6301e77`. Fresh GitHub reads confirmed the complete open draft chain:

| PR  | Head                                                              | Base       |
| --- | ----------------------------------------------------------------- | ---------- |
| #36 | `f99f8cc0b7ae209e27562014e0743f39052f1dad`                        | main       |
| #37 | `0badcc648ec715e20c2be7849d0bdbd8ec0955e0`                        | #36 branch |
| #38 | `c894f7f51f26aae0e9c396a4d791d2bbc0c1a545`                        | #37 branch |
| #39 | `8b8a0aa173bfbc03f0bdb01a3a8953459f86cd0f`                        | #38 branch |
| #40 | `c162fc292d4b9ba8d78c9ae2eb4c0c08485119ee`                        | #39 branch |
| #42 | `2470adf349cbf3995e375bd9c69a12b4945eb204`                        | #40 branch |
| #43 | `fe63c57e928bca78c23e43877480b36a2d8e26c6`                        | #42 branch |
| #44 | `5be0de2a8a2dc3563ceac80f1a197f75cba24bb4`                        | #43 branch |
| #45 | `04768d281b0eca3a2c146dbf35d153b6b6301e77`                        | #44 branch |
| #46 | `65ef33366fef8025a9d62671524801b8510fa1d7` before this checkpoint | #45 branch |

Remote main remains `6df35d700cc13d60ceab3e92293635575479ec4d`. No merge or CI-trigger expansion occurred. The [master plan](studio-portal-modernization-master-plan.md), [credit diagnostics](credit-coverage-diagnostics.md), [credit reliability](credit-lifecycle-reliability.md), [occurrence safety](occurrence-safe-lesson-changes.md), [bulk backend](bulk-lesson-management.md), [bulk interface](bulk-lesson-interface.md), [student workspace](student-workspace-experience.md), [integrated acceptance](wave-one-integrated-acceptance.md), [staging proposal](wave-one-staging-proposal.md) and [PR #45 recovery](wave-one-staging-recovery.md) retain their scope and evidence limits. Wave 2 has not started.

## Current infrastructure, read only

| Item                         | Verified state                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Allowed Netlify              | `coachd-staging`, `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`                                                                      |
| Allowed Supabase             | `lrxrivfqjpkvygozphoz`                                                                                                        |
| Published staging deployment | `6ace53e7f850061d7c49b711`, production context, old main commit, unchanged                                                    |
| Access                       | Team login required for **all** deployments; no protection setting changed                                                    |
| Git builds                   | `stop_builds=true`, repository branch/allowed branches remain main; 0 active among 96 inspected builds, 0 hooks               |
| Publication policy           | Dashboard blocks CLI/MCP/API production publication; only production Git-branch changes may publish. Leave this policy intact |
| Environment                  | Exactly 10 entries, all deploy-preview only; shared team environment empty                                                    |
| Build values                 | Staging Supabase URL and staging anon key; `VITE_QUERY_LAYER_V2=true`                                                         |
| Function configuration       | Staging Supabase URL/anon key; studio `coachd-staging`, ID `4ceff683-e72f-4b2e-96ce-85db2dca4eb2`; matching E2E studio ID     |
| Secrets                      | Service-role key and fixture token remain function-only secrets; no credentials copied to Linux                               |
| Providers                    | No Stripe, Google, Gmail or `E2E_EPHEMERAL` environment entries                                                               |
| Migrations                   | 57 installed, last `20261015123428` / `student_workspace_summary`; no migration applied or changed                            |
| Synthetic business data      | 0 lessons, outbox messages, credit coverage jobs, bulk jobs and storage objects                                               |
| Auth                         | Read-only CLI config diff confirms Site URL `http://localhost:3000`, empty redirect allowlist; unchanged                      |

The six installed Wave 1 additions remain, in order: `20261014142813_credit_coverage_diagnostics.sql`, `20261014151934_credit_lifecycle_reliability.sql`, `20261014163444_occurrence_safe_lesson_changes.sql`, `20261014203257_bulk_lesson_management.sql`, `20261014224415_lesson_bulk_review_context.sql`, `20261015123428_student_workspace_summary.sql`. Do not replay them against staging.

Production Netlify `93829451-dbcf-4863-a07f-fa448cb17494` and Supabase `htwthzshhilrjtqwprlo` are excluded. No production service was queried or changed.

## Legacy schedules: evidence and containment decision

Read-only inspection of the actual published deployment confirms these declarations:

| Function            | Schedule       | Existing requests in the inspected window | Result                                  |
| ------------------- | -------------- | ----------------------------------------- | --------------------------------------- |
| booking-maintenance | `*/5 * * * *`  | 18                                        | all 502, missing Supabase configuration |
| calendar-worker     | `*/5 * * * *`  | 18                                        | all 502, missing Supabase configuration |
| outbox-worker       | `*/5 * * * *`  | 18                                        | all 502, missing Supabase configuration |
| provider-intake     | `*/10 * * * *` | 9                                         | all 502, missing Supabase configuration |

Window: **2026-10-16 13:40:00–14:10:00 UTC**, 09:40–10:10 Eastern. The complete single request-log page contains 63 requests and reports no next page. Every request has “Supabase is not configured.” at service-client initialization. Duplicate log lines are not additional requests. Calendar also contains one platform-runtime “Failed to get next invocation, error 403” line; this is not a provider success.

Traceable samples: maintenance `01M52GFXXVQMGZGAK175QE24DX`, calendar `01M52GFY9XH9ANMQK368TWEK6K`, outbox `01M52GFXT80W6VR1MCXH5T4BE0`, provider `01M52G9TSXCWFJH3GPFSVWBKY3`. Existing request details were read; no function was invoked.

The source at the **published old commit**, rather than the new candidate, shows all four handlers calling `serviceClient()` before database/provider work. Its environment reader throws on a missing Supabase URL before constructing a client. Together with the observed errors, this establishes that these sampled runs failed before database access, message delivery, Calendar calls or Stripe work. It does **not** prove absence of every historical snapshot credential or all past activity. The inference that the scheduled logs correspond to the unchanged published snapshot follows Netlify's published-only scheduling model. [Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/).

**Decision:** preserve the verified frozen, fail-closed state for the narrowly scoped draft recommendation. The earlier evidence gap now has observations for all four functions. A new unpublished preview does not activate its schedules or repair the old snapshot's missing configuration. Keep production-context values empty, inherited values empty, build freeze and publication restrictions intact. Current environment values are not a substitute for frozen snapshot evidence. [Function environment snapshots](https://docs.netlify.com/build/functions/environment-variables/).

Residual risk: the old timers still run, fail and may consume function usage. This is bounded current evidence, not permanent disablement. Recheck all four immediately before an authorized upload; any successful run, new side effect, changed publication or changed credential scope makes the recommendation **NO-GO** pending investigation. Do not call provider-health or Run now to test this.

### Separately authorizable containment option — not performed

The supported control is **coachd-staging → Project configuration → Configuration → Danger zone → Project availability → Disable project**. The authenticated dashboard currently says the project is enabled and describes stopping bandwidth, functions and other resource consumption. Netlify documents this as reversible project disablement. [Disable a project](https://docs.netlify.com/manage/projects/disable-project/).

Exact scope: only staging site `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`; no deletion, credential change, migration or production operation. It makes **all staging project URLs, including previews, inaccessible**. It is not a per-worker pause. No documented per-function disable control was found. Re-enabling may resume the old published timers, so disable/re-enable is not a durable schedule-removal strategy.

If separately approved: reverify the site ID, perform that one control, verify disabled state and observe existing invocation logs over at least 20 minutes after in-flight retries settle. Do not invoke workers. Do not re-enable automatically. Re-enablement needs its own approval and safety review. Full-site disablement is therefore an optional containment alternative, not an unmentioned prerequisite compatible with immediate browser acceptance. Neither disable nor enable was executed.

## Linux packaging blocker resolved

The user explicitly authorized installing a Linux environment. WSL installed **Ubuntu 24.04.5 LTS x86_64** under WSL 2; no reboot was required. WSL is 3.0.3.0, kernel 6.18.54.1-1. A non-root, locked-password `studio-validation` user is the distribution default. No cloud runner, paid infrastructure, database server or provider credential was provisioned.

Node **22.22.0**, npm **10.9.4**, were installed from the official Linux x64 distribution after matching SHA-256 `9aa8e9d2298ab68c600bd6fb86a6c13bce11a4eca1ba9b39d79fa021755d7c37` against its official checksum file. Tooling and evidence live outside the Windows checkout under `/home/studio-validation/studio-portal-validation`. No synthetic password, service-role key, fixture token or Netlify token was transferred there.

The Linux application checkout is clean, detached at the exact application pin, with a lockfile-based `npm ci --ignore-scripts --no-audit --fund=false`. Lockfile SHA-256 is `c1de2bdb184e932b9647d5d0648e6243ed185b58f755f377e31031c7cabaa3e9`. Packaging runs used a cleared environment with only the three public staging build values and verified non-secret release metadata.

Two independent local packaging passes succeeded:

1. `scripts/staging/verify-linux-package.mjs` uses separately installed official `@netlify/zip-it-and-ship-it@16.0.0` and `smol-toml@1.5.2`. It verifies source, lockfile, staging URL/anon JWT identity, query mode, release metadata, bundle budgets, all function runtimes and native files. [Full client/function identity](wave-one-linux-packaging-evidence.json).
2. Official **Netlify CLI 27.8.0** ran `netlify build --offline --context deploy-preview` on that clean Linux checkout, without Netlify authentication or any deploy command. Its own manifest contains **23 functions, all `nodejs22.x`**, with expected routes and four schedule declarations. [Official CLI artifact identity](wave-one-netlify-linux-evidence.json). Offline build completed in 24.2 seconds; bundling took 10.1 seconds. No upload occurred.

Both extracted invoice bundles include Linux Sharp **0.35.5**, libvips **8.18.7** and `public/fonts/invoice-sans.ttf`. The first verifier checks the native ELF signature and rejects Windows native files. Each bundle's Sharp renders a 32×16 PNG locally. Each extracted invoice user module imports and answers a local GET with 405 while global fetch is disabled. These are local module/native checks, not a claim of hosted Lambda execution, invoice RPC execution or a delivered PDF.

Key raw evidence hashes:

| Evidence                           | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| Standalone packaging identity JSON | `b7d390084d116a7ac07ee9644b33498c83c000430851520fca9b87601943ecfd` |
| Standalone invoice ZIP             | `cd1ff89c4e61ac417684387ba6055cf50ea0c8b698345e82cb6859a6786c1af4` |
| Official CLI function manifest     | `4484bdde3c4e4a8ca5a603fd5a34c8784acd1df61f7ef8847f9e663975b00270` |
| Official CLI invoice ZIP           | `1e763fed07436e1e592192f075ef63094a573f796d976f1d5c9fbfacf52cbacb` |
| Rendered PNG, both passes          | `387684da1448471d0b16aa2db5e5f80ce6c0a790311ab6ead4802ceae02b3f1c` |

Raw logs, ZIPs and manifests remain locally in `evidence-20261016-2`; checked-in JSON contains no credentials, URLs with tokens or private content. ZIP hashes differ between the standalone and CLI bundlers; they identify distinct passes, not interchangeable artifacts. A future authorized build must record its own manifest and returned deployment identity. No Windows-native dependency tree may be uploaded.

## Runtime origin review

Independent review found no necessary application change. The candidate's `portal-url.ts` accepts trusted platform/build metadata only, never request Origin/Host headers. Production context also requires a recognized HTTPS production site URL with no credentials or non-default port. A staging site's production context fails that identity check. Supported production aliases still return the canonical production origin.

Non-production prefers `DEPLOY_URL`, rejects production hosts/subdomains, credentials and unsafe protocols, and keeps the explicit ephemeral loopback exception. Compatibility fallbacks to prime/site URL still exist; the resolver alone is **not** a universal immutable-host guarantee. This deployment procedure requires Netlify's actual `DEPLOY_URL` to equal the returned immutable permalink and requires preview release context. Missing or inconsistent metadata is a gate failure. Do not pass request values or fabricate deploy URLs to satisfy it.

Fresh focused regression checks passed **18 tests in 2 files** (`portal-email.test.ts`, `release-metadata.test.ts`). The Linux client contains the staging Supabase URL and only that project's anon JWT claims; no production project ref, production portal URL or service-role JWT was found. Generated release identity is `deploy-preview` / `0b18a5a2238d`. Bundle budgets passed at 111,672 bytes JS gzip / 23,090 bytes CSS gzip, with the existing CSS warning. No runtime code, financial command or schema was changed here.

## Corrected deployment specification — authorization required

**Do not use the previous `--no-build --context ... --skip-functions-cache` recipe.** CLI 27.8.0 rejects context selection with no-build. Skipping its generated manifest would also re-bundle functions through a different configuration path, without the verified Node 22 metadata. Pre-zipped input is not a substitute for the route/runtime/schedule manifest.

The supported proposed action uses the CLI's integrated build and draft upload on Linux. Its build path derives the function runtime from Node 22 and immediately reuses the fresh function manifest. Source inspection confirmed this behavior; the offline CLI build above confirms the manifest. The function-cache TTL is two minutes: do not pause or manually edit the manifest between build and upload. [CLI deployment reference](https://cli.netlify.com/commands/deploy/).

After explicit authorization, using normal supported CLI login and the clean Linux checkout at the approved application SHA:

```text
# Verify git HEAD and clean status, Node 22, site ID, actual preview values,
# protection, no providers, unchanged old publication and fail-closed logs first.
# Set COMMIT_REF only from the verified git HEAD; context comes from CLI config.
# Never inject CONTEXT/URL/DEPLOY_URL/DEPLOY_PRIME_URL through deploy overrides.
npx netlify-cli@27.8.0 deploy --draft --context deploy-preview --site d83ff6cb-f57b-4741-8c3c-3eaae7adab19 --message "Wave 1 approved 0b18a5a2238daa49bec1290f5884d5792f4aefc9" --json
```

This command allocates a remote draft **before** its build; it is not a dry run and was not executed. No alias, production, production-if-unlocked, trigger, source-zip upload or credential override is allowed. The CLI flag selects build environment; the returned API record must independently establish actual deploy-preview context. Build-only values remain the three public browser values; server credentials remain existing function-only preview secrets. Do not add credentials to another context.

Expected effects: create one protected unpublished deployment and upload its client/function snapshot, consuming ordinary account build/function-storage usage. No published-site replacement, worker cadence activation, database migration or provider transaction is intended. Netlify's returned 24-hex deployment ID determines the immutable host; none exists yet. Retain only sanitized metadata because raw deploy responses can contain platform tokens.

Before app authentication, verify returned site ID, `state=ready`, `context=deploy-preview`, `published_at=null`, exact deploy-ID permalink, unchanged old published ID, all 23 runtimes `nodejs22.x`, actual artifact identity, trusted deploy origin and release health. `commit_ref` may legitimately be null for manual uploads; connect it honestly to the clean source, generated release and hashes. Recheck anonymous denial for login, health, API, authenticated route and a static asset; never weaken team-login protection. Any mismatch is a stop, not permission to restore/publish, retry under production context or broaden secrets.

## Auth and protected browser readiness

`scripts/staging/prepare-auth-config.mjs` prepares a minimal external config only. It requires a sanitized **real** ready/unpublished deployment receipt, verified source SHA and protected health result. Map Netlify's actual deploy permalink (normally `deploy_ssl_url`) to the receipt's `permalink`; do not use the base-site URL. The generator rejects wrong sites, publication, mutable hosts, mismatched IDs and unverified candidates. It performs no API calls and refuses to overwrite an existing config.

After an authorized upload and protected health read, its exact values will be:

```text
site_url = https://ACTUAL_RETURNED_ID--coachd-staging.netlify.app
additional_redirect_urls = [
  https://ACTUAL_RETURNED_ID--coachd-staging.netlify.app/auth/callback,
  https://ACTUAL_RETURNED_ID--coachd-staging.netlify.app/auth/callback\?**
]
```

The placeholder above is deliberately not an invented deploy ID. The generated TOML escapes the literal query delimiter correctly, grants no wildcard hostname/path, and declares only these two Auth properties. Offline fixture tests and a real TOML parser verified the result without writing hosted settings. [Supabase redirect patterns](https://supabase.com/docs/guides/auth/redirect-urls).

After separate Auth-configuration approval: generate the private external file, run `supabase config diff --project-ref lrxrivfqjpkvygozphoz --workdir PRIVATE_CONFIG_DIR`, review only the two declared Auth changes, use supported config push, and repeat the diff. Preserve unrelated remote-only defaults. Noninteractive push may not prompt; never treat that as approval. Current localhost/empty settings are unchanged and must not be treated as ready for redirect journeys.

`protected-browser.mjs` remains a separate first-login helper. It now blocks service workers so application interception cannot be obscured, and validates synthetic account UUIDs before submitting credentials. A human reviewer must complete normal Netlify team login on the actual immutable host. Capture only secure, unexpired exact-host perimeter cookies outside Git, with Owner/SYSTEM ACLs on Windows; no dashboard cookies, broad-domain cookies or app localStorage are copied. The dashboard session is not a demonstrated Playwright perimeter session.

After **separate browser-auth-check approval**, the helper checks protected health/candidate first, then signs in the existing confirmed synthetic coach, student and guardian using the ordinary password UI and verifies exact user/role. It allows only the immutable host, staging Supabase and static font hosts. It invokes no fixture, provider, worker, checkout, reset, invitation or send endpoint. Sign-in itself changes staging Auth/session metadata and may claim linked access, so it was not run here. No invitations, OTP, OAuth, resets or real messages are authorized.

The full hosted acceptance harness remains a later gap: fixture fetches and independently created browser contexts are not yet all perimeter-aware. First login does not prove full Wave 1 task acceptance, hosted accessibility or provider integration. The alternate query-mode build and isolated provider credentials remain later acceptance requirements.

## Validation, remaining approvals and recommendation

Freshly completed: clean Linux lockfile installation; staging-configured TypeScript/Vite build; native Linux packaging and extracted invoice import/render in two passes; official offline CLI manifest verification; 18 focused origin/release tests; 6 Node helper tests; helper lint, formatting, credential and whitespace checks. The earlier 747-test application run and PR #45 database/authorization/concurrency results remain prior evidence; no full database replay or hosted authenticated acceptance was rerun here. PR #46's dependent base remains outside automatic CI triggers; do not imply these local results are new GitHub CI runs.

Changes in this checkpoint: this report and two sanitized artifact identities, a current-checkpoint link/obsolete-command correction in the prior gate, the Linux verifier, the Auth-config generator with negative tests, and the browser helper's local guard improvements. No application candidate change is required.

Separate authorization is still required for:

1. **One draft deployment** of the exact application pin to the exact staging site via the command above, accepting the documented unchanged fail-closed legacy cadence. Reverify current state immediately before execution.
2. **Optional whole-project disablement** if the owner prefers all timers stopped; this also blocks preview access. Any re-enable is a separate action.
3. **Exact returned-host Auth configuration** after the deployment ID exists, and protected first-login checks for the existing synthetic accounts. Neither is implied by upload-only approval.
4. **Hosted synthetic fixtures, financial/bulk browser mutations, cleanup and full acceptance**, after the perimeter-aware harness is reviewed; worker/provider acceptance remains separately scoped and credential-gated.
5. Any provider credentials/activity, publication, merge, production operation or paid resource remains outside this checkpoint. No such action is proposed for the first draft.

**Final recommendation: GO for review and explicit authorization of the narrow protected staging draft. NO-GO for execution without that authorization, full staging acceptance, publication or production.** The Linux/native blocker is resolved, the app pin is preserved, and all four old workers now have bounded fail-closed evidence. Active legacy timers, actual returned-host Auth settings, a real perimeter session and hosted acceptance remain explicit limits. Nothing was deployed, disabled, re-enabled, merged, published, reconciled or sent. The 57 migrations and staging credentials were preserved.
