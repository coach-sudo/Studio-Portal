# Wave 1 first protected application deployment gate

October 16, 2026 (Eastern). **Staging deployment: NO-GO pending the gates below. Production: NO-GO. No deployment is authorized or executed by this document.**

This follows [staging recovery](wave-one-staging-recovery.md), [the configuration checkpoint](wave-one-staging-checkpoint.json), [integrated acceptance](wave-one-integrated-acceptance.md), and [the master plan](studio-portal-modernization-master-plan.md). It replaces their proposed first-deployment candidate only where explicitly stated below. No migration is added or changed.

## Candidate and dependencies

The original application candidate is `fe63c57e928bca78c23e43877480b36a2d8e26c6` (draft PR #43). The newly proposed application candidate is **`0b18a5a2238daa49bec1290f5884d5792f4aefc9`**. It is on `codex/wave-one-first-deployment-gate`, directly based on draft PR #45 at `04768d281b0eca3a2c146dbf35d153b6b6301e77`. Later documentation-only commits on this branch are not substitutes for this application pin.

The narrowly scoped runtime change:

- A `production` context now requires a trusted production site URL as well. A staging site's published deployment cannot generate production CTAs merely because its build says `production`. Missing or inconsistent identity fails closed.
- Non-production links prefer trusted `DEPLOY_URL`, the immutable deployment, over a potentially mutable `DEPLOY_PRIME_URL`. Existing preview/ephemeral fallbacks remain compatible. Production hosts and their subdomains are rejected in non-production.
- No request header controls the origin. The existing production canonical URL and known legacy production aliases remain supported.

Changed code is `netlify/functions/_shared/portal-url.ts`, its `portal-email.test.ts` regression coverage, and a separate staging browser preparation script/test. Browser auth redirects still use the current window origin; application commands still use relative `/api/…` paths. The new candidate needs explicit review/approval before deployment; do not deploy the old candidate as though it contains this fix.

Fresh GitHub reads confirmed these open draft dependencies; none was merged:

| PR  | Exact head                                 | Base       |
| --- | ------------------------------------------ | ---------- |
| #36 | `f99f8cc0b7ae209e27562014e0743f39052f1dad` | `main`     |
| #37 | `0badcc648ec715e20c2be7849d0bdbd8ec0955e0` | #36 branch |
| #38 | `c894f7f51f26aae0e9c396a4d791d2bbc0c1a545` | #37 branch |
| #39 | `8b8a0aa173bfbc03f0bdb01a3a8953459f86cd0f` | #38 branch |
| #40 | `c162fc292d4b9ba8d78c9ae2eb4c0c08485119ee` | #39 branch |
| #42 | `2470adf349cbf3995e375bd9c69a12b4945eb204` | #40 branch |
| #43 | `fe63c57e928bca78c23e43877480b36a2d8e26c6` | #42 branch |
| #44 | `5be0de2a8a2dc3563ceac80f1a197f75cba24bb4` | #43 branch |
| #45 | `04768d281b0eca3a2c146dbf35d153b6b6301e77` | #44 branch |

Remote `main` remains `6df35d700cc13d60ceab3e92293635575479ec4d`. All preparation commits/PR titles retain `[skip netlify]`. This branch's base is outside the existing automatic CI allowlist; local checks are reported separately from GitHub CI. No workflow trigger or deploy permission is broadened.

## Fresh infrastructure checks

| Check                    | Verified result                                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allowed Supabase         | `lrxrivfqjpkvygozphoz`, `ACTIVE_HEALTHY`, `us-west-1`, PostgreSQL `17.11.0.003`                                                                                                                                             |
| Migrations               | **57/57** installed; last `20261015123428` / `student_workspace_summary`                                                                                                                                                    |
| Allowed Netlify          | `coachd-staging`, `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`                                                                                                                                                                    |
| Site perimeter           | Team login enabled, scope **all**; dashboard Visitor access confirms **Production: Private** and **Deploy Preview: Private**; anonymous GETs to `/login`, `/coach`, `/api/healthz`, `/api/v2/lessons` returned **401 HTML** |
| Automatic builds         | `stop_builds=true`; repository still linked to `main`, allowed branches `[main]`; **0 active builds** among 96 inspected; **0 build hooks**                                                                                 |
| Shared team variables    | Empty                                                                                                                                                                                                                       |
| Site variables           | Exactly **10**, all `deploy-preview` only; no production, all-context, or branch values                                                                                                                                     |
| Browser configuration    | Build-only `VITE_SUPABASE_URL=https://lrxrivfqjpkvygozphoz.supabase.co`, staging anon key, `VITE_QUERY_LAYER_V2=true`                                                                                                       |
| Server configuration     | Function-only `SUPABASE_URL`, anon key, `STUDIO_SLUG=coachd-staging`, `STUDIO_ID` and `E2E_STUDIO_ID` both `4ceff683-e72f-4b2e-96ce-85db2dca4eb2`                                                                           |
| Server secrets           | Function-only secret `SUPABASE_SERVICE_ROLE_KEY` and `E2E_FIXTURE_TOKEN`; neither is build-scoped or `VITE_`                                                                                                                |
| Providers                | No Stripe, Google, Gmail, or `E2E_EPHEMERAL` site variable; no inherited team variable                                                                                                                                      |
| Supabase Auth            | Current Site URL **`http://localhost:3000`**; redirect allowlist **empty**, read using CLI `config diff` only                                                                                                               |
| Published staging deploy | Still **`6ace53e7f850061d7c49b711`**, ready, context `production`, old commit `6df35d700cc13d60ceab3e92293635575479ec4d`                                                                                                    |

Forbidden targets remain Supabase `htwthzshhilrjtqwprlo` and Netlify `93829451-dbcf-4863-a07f-fa448cb17494`. No production API, data, credentials, or settings were used for this gate.

The six Wave 1 additions remain installed in dependency order; do not apply them again:

1. `20261014142813_credit_coverage_diagnostics.sql`
2. `20261014151934_credit_lifecycle_reliability.sql`
3. `20261014163444_occurrence_safe_lesson_changes.sql`
4. `20261014203257_bulk_lesson_management.sql`
5. `20261014224415_lesson_bulk_review_context.sql`
6. `20261015123428_student_workspace_summary.sql`

## Blocking issue: the existing published deployment

The published deployment metadata still declares `booking-maintenance`, `calendar-worker`, and `outbox-worker` every five minutes, and `provider-intake` every ten minutes. **Build freeze and site-login protection do not disable scheduled work.** Netlify documents that schedules execute for published deployments, while previews do not run on cadence. No worker was invoked to investigate this. [Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/).

Read-only dashboard inspection additionally confirmed `booking-maintenance` is **running in production**, scheduled every five minutes, with its next execution displayed as October 16 at 10:05 a.m. Eastern. Existing 9:55 a.m. log entries fail immediately at service-client initialization with **“Supabase is not configured.”** These observed invocations were not requested by this work. They demonstrate that build freeze does not stop this legacy timer, and that those sampled maintenance runs did not reach a database. They do not prove the execution history or retained credentials of every other function. Today's empty production-context variables do **not** establish the contents of all older snapshots. Do not run the old provider-health endpoint: it can call providers when old credentials exist.

Before GO, obtain supported, read-only evidence that the old published workers cannot access forbidden systems, or separately approve a concrete supported containment action. Dashboard Developer settings also confirms **only production Git-branch changes may publish**: CLI/MCP/API production publication is blocked, while preview/branch uploads remain allowed. Do not weaken that policy, push an inert artifact to `main`, or suggest manual production-context publication as an available shortcut. A vendor-supported schedule-disable/unpublish control, if available and verified, would require its own exact staging-only action review. Otherwise seek provider-supported snapshot evidence/containment before proceeding. Do not add credentials to production context, restore an old deployment, revoke production credentials, delete the site, or invoke workers to test it. No containment action was executed.

## Supported manual mechanism and immutable identity

Inspected official Netlify CLI **27.8.0** help and installed source, including `commands/deploy/deploy.js`, `utils/deploy/deploy-site.js`, `utils/env/deploy-env-vars.js`, and the OpenAPI schema. The supported mechanism is a **manual draft upload of a clean, pinned, prebuilt application and functions**, without an alias or production flag. It does not depend on Git builds, a merge, or pushing to `main`.

Important distinctions:

- CLI `--context deploy-preview` selects configuration for local build/env resolution. It is not a writable API deploy-context field. Do not claim that flag alone proves runtime context. The draft API request uses `draft:true`; CLI-created historical drafts on this exact site have `context=deploy-preview`, unique deploy-ID permalinks, and no publication timestamp. The actual new record must be checked before any application authentication or mutation.
- The official API supports draft uploads without replacing the published deployment. The CLI's no-alias/non-production path explicitly produces `draft:true`. Avoid `--alias`, `--prod`, `--prod-if-unlocked`, `--trigger`, anonymous creation and any publish/restore operation. [CLI deploy reference](https://cli.netlify.com/commands/deploy/), [draft API deploys](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/#draft-deploys).
- Supply `COMMIT_REF` from `git rev-parse HEAD` only after a clean checkout is proved equal to the approved full SHA. Use build context `deploy-preview`; the existing generator embeds that context and the shortened verified SHA into both client/function artifacts. Do not inject reserved `CONTEXT`, `COMMIT_REF`, `URL`, `DEPLOY_URL`, or `DEPLOY_PRIME_URL` using deploy overrides. They must retain trusted build/platform provenance.
- The build reads only the three public browser values for Vite. Function credentials stay in the existing function-only preview configuration. Never pass secrets as CLI arguments, copy them into `dist`, or copy them to another context. A missing preview secret is a failure, not a reason to broaden its scope.

**Execution specification after all gates and explicit authorization** (not executed):

```text
# From a clean Linux x64 checkout of the approved full candidate, using Node 22.
# COMMIT_REF must equal git rev-parse HEAD; CONTEXT must be deploy-preview.
# NETLIFY_SITE_ID must equal the allowed staging site ID.
npm ci --ignore-scripts
npx netlify-cli@27.8.0 build --context deploy-preview
# Inspect dist, release metadata, Linux native dependencies and function manifests.
# Stop on any target/runtime/origin/scope mismatch; no upload occurs during build.
npx netlify-cli@27.8.0 deploy --no-build --context deploy-preview --site d83ff6cb-f57b-4741-8c3c-3eaae7adab19 --skip-functions-cache --message "Wave 1 approved candidate FULL_SHA" --json
```

Use supported Netlify CLI authentication; never extract local dashboard/CLI tokens. Capture only sanitized deployment metadata; raw deploy responses may include platform tokens. Record returned `id`, `context`, `site_id`, `published_at`, permalink, function runtime, and a manifest of artifact SHA-256 hashes. Manual deploy records may have a null `commit_ref`; an honest record ties the clean source SHA, embedded release metadata and artifact hashes to the returned deploy ID rather than inventing a Git field.

The only application origin is `https://<returned-24-hex-deploy-id>--coachd-staging.netlify.app`. Its ID is allocated by Netlify, so it cannot be truthfully filled in before an authorized deploy request. Do not use the base domain, `main--`, a moving PR URL or a made-up SHA alias for acceptance. Verify new context `deploy-preview`, `published_at=null`, and unchanged published staging deploy ID. Preview schedules stay dormant; never use Run now. [Netlify environment variables](https://docs.netlify.com/build/environment-variables/overview/).

Expected effects: upload one protected unpublished application/function snapshot; consume normal build/upload/storage usage; create no new infrastructure or financial/provider operation; retain the site-wide team-login gate. Application side effects begin only when commands are later invoked. Existing old published schedules are a separate containment gate, not something this upload disables.

## Build and runtime packaging gate

Both the original and new pinned candidates were built from Git archives in external disposable directories with Node **22.22.0**, actual staging browser configuration and explicit preview release metadata. No environment file or service credential was copied into those exports. Type checking and Vite compilation passed for the original; new candidate results are recorded below.

The installed application dependencies on this Windows machine contain `@img/sharp-win32-x64` and WASM, but no Linux x64 Sharp binary/libvips. `invoice-pdf` explicitly externalizes `sharp`. CLI source warns that native dependencies must match the deployed runtime; a successful client build is not evidence of a usable Linux invoice function. WSL has no installed distribution and Podman has no machine. **Do not upload this Windows dependency tree.**

Use an existing approved Linux x64 runner, or separately approve preparing a local Linux runtime. Install from the lockfile there; execute a local Sharp render and verify bundled Linux native files/font before upload. Inspect the function manifests for the intended supported Node runtime and verify the invoice function locally. No runner credential or workflow permission has been provisioned, and no container/VM was created in this gate. An existing CI pass is supporting evidence, not a reusable staging deployment artifact.

## Supabase Auth configuration proposal

After the deployment ID is known and before any redirect-based journey, the exact proposed staging Auth values are:

```text
site_url = https://<returned-deploy-id>--coachd-staging.netlify.app
additional_redirect_urls = [
  https://<returned-deploy-id>--coachd-staging.netlify.app/auth/callback,
  https://<returned-deploy-id>--coachd-staging.netlify.app/auth/callback\?**
]
```

The escaped literal `\?` followed by the query wildcard covers existing `returnTo` and reset-action parameters on the same exact callback path; unescaped `?` would be a one-character wildcard. In a TOML double-quoted string, encode that backslash as `\\?`; a TOML literal single-quoted string preserves `\?` directly. The hostname and path are not wildcarded. No production origin, base staging domain, loopback origin, provider domain, `*.netlify.app`, or all-project preview wildcard is allowed. Supabase requires permitted redirect destinations; its documented glob rules support escaping. [Auth redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).

Prepare a **minimal** external `supabase/config.toml` declaring only those two Auth properties. Run `supabase config diff --project-ref lrxrivfqjpkvygozphoz --workdir ABSOLUTE_PRIVATE_CONFIG_DIR`, inspect the two declared changes and preserve unrelated settings. Only after explicit configuration authorization use the supported config push and repeat the diff. Do not push the repository's full local-development config. CLI config push in noninteractive mode can proceed without a prompt; no push was run in this gate.

This approves no invitations, password resets, OTP, OAuth, SMS or SMTP changes. The first login check uses existing confirmed synthetic accounts and passwords only. Password sign-in does not require redirect URLs; the localhost setting remains a recorded readiness failure, not permission to run email journeys. The exact-ID Auth configuration action must be included in the later authorization scope.

## Protected browser preparation

The two independent sessions are Netlify team-login protection and Supabase app login. No bearer header substitutes for the perimeter. The in-app browser has an authenticated Netlify owner dashboard session, permitting read-only confirmation of private visibility and deployment policy. This is not a demonstrated perimeter session in the separate Playwright browser or on a not-yet-created immutable deployment host.

`scripts/staging/protected-browser.mjs` is a separate first-login tool, **not a claim that the full acceptance harness is perimeter-ready**. Its local safety tests cover forbidden/mutable hosts, credentials in URLs, private-path restrictions, expiry and parent-domain cookie exclusion.

After deployment and browser-check authorization:

1. Use the exact immutable origin and a private external directory with Owner/SYSTEM-only NTFS ACLs (or owner-only Unix permissions). No password, cookie, session state or fixture token belongs in Git or shared artifacts.
2. Run `capture EXACT_ORIGIN ABSOLUTE_PRIVATE_STATE_PATH` with the script. The authorized reviewer completes normal Netlify team login in that browser. No permissions or site protection are changed. The tool checks the actual portal login screen and saves only secure, unexpired cookies for that exact deployment host; dashboard sessions, parent-domain cookies and localStorage are excluded. Do not assume an in-app-browser login is shared with Playwright.
3. Run `check EXACT_ORIGIN ABSOLUTE_PRIVATE_STATE_PATH ABSOLUTE_SYNTHETIC_CREDENTIALS_PATH 0b18a5a2238daa49bec1290f5884d5792f4aefc9`. The existing private credentials file identifies the approved project/studio and coach/student/guardian users at `coachd-staging.example.test`.
4. Each independent context first checks release health with perimeter cookies and no redirects. It then uses the ordinary password UI and verifies the exact expected synthetic user and role route. Browser requests outside this deployment, staging Supabase and static font hosts are blocked. No fixture setup/cleanup, provider-health, worker, send, invitation, checkout or reset endpoint is invoked. Auth sessions are not persisted. A login can update staging Auth/session metadata and claim existing linked access; it is not a financial acceptance run.
5. Verify an anonymous browser still reaches Netlify protection on `/login`, `/api/healthz`, authenticated routes and an actual asset. Verify `/api/v2/lessons` is gated with a safe GET, not a mutation. Stop if cookies expire or any route bypasses the perimeter. Do not log credential bodies or export sensitive traces.

The existing deployed Playwright global setup/teardown uses plain fetch for fixtures, and several specs create independent browser contexts. It does not yet copy this perimeter session into all API contexts. Do not run it against the hosted preview or label a first-login check as the complete 122-execution acceptance suite. A subsequent reviewed harness change and approved synthetic mutation/cleanup scope remain necessary. Provider acceptance and the `false` query-mode build remain later gates.

## Validation and decision

New candidate validation:

- **747 Vitest tests / 115 files passed**, zero failures, including the new origin cases. The separate Node test runner passed **4** perimeter/path isolation checks. The initial unit discovery overlapped a helper rename; a fresh complete run passed after the helper adopted the repository's separate `test-*.mjs` convention.
- TypeScript and the actual staging-configured Vite build passed using Node **22.22.0** and a Git archive of the exact new pin. Generated release is `deploy-preview` / `0b18a5a2238d`. Vite's optimized `production` build mode is distinct from Netlify's deployment context.
- Actual client output contains the staging Supabase URL and only `anon` JWT claims for that project; no production project ref, production portal URL, or service-role JWT. Public query mode was freshly read as `true` from the approved build scope before compilation.
- Bundle budgets passed: largest ordinary JS **111,672 bytes gzip**, CSS **23,090 bytes gzip**, below 130,000/25,000 failure limits; existing 22,000-byte CSS warning remains. The CI-placeholder-only bundle assertion is inappropriate for real staging values and was replaced by the explicit actual-project/JWT inspection above plus the ordinary budget check.
- Full ESLint returned zero errors with existing warnings. The four changed code/helper files passed **zero-warning** ESLint. Repository format, credential scan and whitespace checks passed.
- Fresh staging reads still show **zero** lessons, outbox messages, credit coverage jobs, bulk jobs, and storage objects. The ten environment entries and shared-team emptiness remain verified; no hosted command or fixture mutation ran.
- Fresh GitHub checks on PR #43 remain successful for verify, migrations and both isolated query-mode suites; smoke is intentionally skipped. PR #45 has no check runs on its unlisted dependent base. Those checks apply to their own heads, not the new candidate; new-candidate evidence here is local validation only.

The previous database/schema/authorization evidence in PR #45 remains valid; no migration, schema, financial command, or database concurrency path changed here. Those earlier tests were not rerun. Linux function execution/bundling, authenticated application journeys, provider tests, full perimeter-aware acceptance and hosted accessibility checks are **not passed** by this gate.

Before requesting application deployment authorization, close these items:

- [ ] Review/accept the new candidate and runtime-origin guard.
- [ ] Resolve the old published schedule/snapshot containment issue with concrete supported evidence or separately approved containment.
- [ ] Produce and verify the Linux-compatible function artifact; preserve exact source/config/artifact identity.
- [ ] Include exact-ID Auth settings in the authorized scope and verify them before redirect-based use.
- [ ] Identify an authorized Netlify reviewer to establish the perimeter session for the exact deployment.
- [ ] Recheck all-deploy protection, environment scopes, provider absence, build freeze, queue/hooks and target IDs immediately before any approved upload.

**Recommendation: NO-GO for deployment today.** The supported manual mechanism is identified, the runtime fix is reviewable, and browser preparation is available, but unresolved gates are not converted into assumptions. No application deploy, old-site containment, Auth configuration push, new infrastructure, worker invocation, provider call, message, merge, main push or production operation occurred. The next action is review of this gate package and a concrete authorization decision after its prerequisites are satisfied. Wave 2 has not started.
