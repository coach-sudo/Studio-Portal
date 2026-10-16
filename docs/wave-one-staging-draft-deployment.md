# Wave 1 — first authorized protected staging draft

**Subsequent checkpoint:** [exact-host Auth configuration and private credentials handoff](wave-one-staging-auth-configuration.md) records the separately authorized URL-only update. The deployment/stop report below remains historical; it does not authorize another deployment or application sign-in.

October 16, 2026 (Eastern). **Outcome: PASS. Exactly one draft was created and verified; it is unpublished. Production remains NO-GO.** Execution stopped after the authorized deployment and read-only verification. Auth configuration, synthetic sign-in, fixtures, financial acceptance and further deployments are not authorized by this result.

## Deployment identity

| Field                                      | Verified value                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| Application SHA                            | `0b18a5a2238daa49bec1290f5884d5792f4aefc9`                                         |
| Reviewed preparation head before execution | `00514fc8142e22ca578e1b87469b4fd77bbb50a8`, draft PR #46                           |
| Netlify staging site                       | `d83ff6cb-f57b-4741-8c3c-3eaae7adab19` / coachd-staging                            |
| New deployment                             | `6ad23d4f8b10c10447224155`                                                         |
| Immutable URL                              | <https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app>                     |
| Actual context/state                       | `deploy-preview` / `ready`                                                         |
| Publication                                | `published_at=null`; old publication remains `6ace53e7f850061d7c49b711`            |
| Creation time                              | October 16, **11:05:51 a.m. Eastern** (`15:05:51.698Z`)                            |
| CLI completion                             | **11:06:42 a.m. Eastern**, exit 0                                                  |
| Creation attempts                          | **1**, with no retry or second deployment                                          |
| Protected health                           | `status=ok`, release `0b18a5a2238d` / `deploy-preview`, checked at `15:07:34.867Z` |

The [sanitized receipt](wave-one-staging-draft-deployment.json) preserves exact metadata and check results. The [artifact evidence](wave-one-deployed-artifact-evidence.json) records the actual uploaded build's 117 client asset identities and 23 function identities. These are distinct from earlier preparation artifacts. No raw platform token, private session or credential is included.

The API reports `deploy_source=cli`, `build_id=null` and `commit_ref=null`. It also reports legacy fields `manual_deploy=false`, `branch=main`, and `subdomain_alias=<deploy-id>`. These fields are preserved honestly in the receipt: the recorded operation was the explicit CLI draft command, not a Git build or main push. No user alias was supplied; the returned subdomain is the required immutable deploy ID. Actual preview context, ready state, null publication timestamp, source/artifact proof and unchanged published deployment establish the outcome. A null Git field was not replaced with an invented value.

## Authorized operation and preflight

The user's execution instruction explicitly authorized one protected unpublished draft of this application SHA at this site, subject to mandatory preflight, and excluded all other deployment/production/Auth/provider/financial operations. It supersedes only the deployment-approval gate in the [blocker-resolution report](wave-one-staging-blocker-resolution.md); all other boundaries remain.

Preflight independently confirmed:

- Clean **detached** Linux x64 checkout at the exact application SHA; preparation head was not deployed. Node 22.22.0, npm 10.9.4, pinned Netlify CLI 27.8.0. Lockfile SHA-256 remained `c1de2bdb184e932b9647d5d0648e6243ed185b58f755f377e31031c7cabaa3e9`; 415 installed package versions/integrities matched it.
- All 23 reviewed function ZIP identities/runtimes matched the prior evidence before the final build; no Windows native dependencies appeared. Linux Sharp 0.35.5/libvips 8.18.7 rendered successfully, and the extracted invoice module imported and returned a local 405 with global fetch disabled. Font/native packaging had already passed in both reviewed packaging passes.
- Supabase `lrxrivfqjpkvygozphoz` remained active/healthy. **All 57 version/name pairs exactly matched** the recovery checkpoint. Synthetic studio `4ceff683-e72f-4b2e-96ce-85db2dca4eb2` / coachd-staging remained present; four synthetic Auth users and zero lessons, outbox messages, coverage jobs, bulk jobs and storage objects were unchanged.
- Netlify's exact site and all-deploy team-login requirement, build freeze, **0 active builds among 96**, **0 hooks**, and unchanged published deployment were confirmed. All ten variables remained preview-only; service-role key and fixture token remained secret and function-only. Shared team environment was empty; no Stripe, Google, Gmail or ephemeral-provider settings were present.
- Local public browser values exactly matched current preview build values. Server project/anon identity, studio IDs/slug and `VITE_QUERY_LAYER_V2=true` matched. An additional **authenticated, staging-configured local Netlify build** passed without a remote deployment request or reserved origin/context overrides. Its 117 client asset hashes matched the reviewed staging build, with preview release metadata and all 23 Node 22 functions.
- Recent existing-worker observations remained fail-closed, as detailed below. No worker was invoked for testing.

The official Linux CLI reused the existing logged-in CLI configuration through its normal XDG configuration path and a temporary link to the existing Windows store. No token value was extracted, printed, passed as an argument, copied into the application or granted new cloud access. An unused login ticket was never authorized. The temporary configuration link was removed after verification; existing credentials were not revoked or changed.

The command was executed through the already installed official **27.8.0** CLI entry point, equivalent to:

```text
npx netlify-cli@27.8.0 deploy --draft --context deploy-preview --site d83ff6cb-f57b-4741-8c3c-3eaae7adab19 --message "Wave 1 approved 0b18a5a2238daa49bec1290f5884d5792f4aefc9" --json
```

`COMMIT_REF` came only from the verified Git HEAD. No `CONTEXT`, `URL`, `DEPLOY_URL` or `DEPLOY_PRIME_URL` override was supplied. The supported integrated build selected preview values and generated runtime metadata. No production, alias, trigger, no-build or credential-override flag was used. An outside-repository exclusive-create attempt marker prevents repeating the invocation. CLI output and local raw receipts remain private outside Git; no deployment retry was attempted.

## Post-deployment verification

| Required check                                | Result and evidence                                                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correct site, ready preview, unpublished      | Independently read the returned deployment through the Netlify connector; exact site, `ready`, `deploy-preview`, `published_at=null`                                                                                                                                                                    |
| Immutable identity                            | Returned permalink exactly matches the returned 24-hex deploy ID and coachd-staging host                                                                                                                                                                                                                |
| All-deploy team perimeter                     | Independently re-read protection: team login enabled, scope all; no setting weakened                                                                                                                                                                                                                    |
| Anonymous login/coach/health/API/asset access | Fresh credential-free GETs returned **401 HTML Netlify protection** for all five required paths, with no redirect or application content                                                                                                                                                                |
| Protected release                             | Existing Netlify team session reached read-only `/api/healthz`; exact preview release and expected shortened SHA, no Supabase account sign-in                                                                                                                                                           |
| Source and function identity                  | Full application SHA verified locally; **all 23 remote function digests exactly match the final Linux ZIPs**, all remote runtimes are `nodejs22.x`                                                                                                                                                      |
| Browser configuration/content                 | Actual uploaded build's 117 client assets were hashed/scanned: only staging anon JWT identity; no production Supabase ref, production portal URL or service-role JWT. Protected shell loads expected content-hashed bundles including `supabase-DqUkwEpt.js`, and displays the synthetic staging studio |
| Old publication/build controls                | Existing published ID unchanged, builds still stopped, 0 active builds and 0 hooks after upload                                                                                                                                                                                                         |
| Credential scopes/provider isolation          | Re-read all ten entries and compared before/after values/scope metadata: unchanged, preview-only; no provider credentials added or inherited                                                                                                                                                            |
| Schema/data preservation                      | Re-read migration history and synthetic counts after upload: unchanged 57 migrations, studio/users present, financial/operational queues and history still empty                                                                                                                                        |
| New draft schedules                           | Four declarations appear in the artifact, but this is an unpublished preview; they are not activated on cadence. Old publication remains the schedule source                                                                                                                                            |
| No extra deployment                           | One marker and CLI result, one matching new deploy record, no second invocation or additional deploy creation                                                                                                                                                                                           |

Anonymous paths were `/login`, `/coach`, `/api/healthz`, `/api/v2/lessons`, and `/assets/ActorProfilePreview-RqBciXtI.js`. Netlify team-session verification used normal existing access, with no bearer-header substitution, protection change or synthetic credentials. The sign-in shell was observed only; no form was submitted. This is read-only deployment verification, not an authenticated application journey or hosted task-acceptance pass.

Artifact verification distinguishes remote function-digest comparison from client build inspection and observed browser bundle names. No independent byte-for-byte re-download of every hosted client asset is claimed. Direct JavaScript-file navigation was unsupported in the browser; its supported rendered-page inventory confirmed the actual loaded config chunk. The official immutable upload, independently verified release, matching function digests and expected client asset identities provide the recorded deployment provenance.

Raw local artifact-identity SHA-256: `d7c18269e1191e30657f8659f999cf2e29736f444da90a0010d015eb2179b3a0`. Raw final function-manifest SHA-256: `73f038722865df76cb1a21faaf4a0dd960ec0ef9ab369a75bc46b597d40e82aa`. These identify the final deployment build, rather than reusing the earlier offline-build hashes. The config chunk is 202,939 bytes, SHA-256 `25b37f4b7d90f909748c047ee673bea6687f3988691fda655b9c2ae1627a66ad` in that build.

## Legacy worker observations

The published old snapshot retains maintenance/calendar/outbox every five minutes and provider intake every ten. No disable, invocation, modification or publication was performed. Recent request logs were read, not generated by this work.

| Function            | Final preflight, 14:40–15:04 UTC                                      | Postflight, 15:05–15:12 UTC                                         |
| ------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| booking-maintenance | 15 requests, all 502; 13 missing-config logs, 2 without attached logs | 6 requests, all 502; 4 missing-config logs, 2 without attached logs |
| calendar-worker     | 15 requests, all 502; 13 missing-config logs, 2 without attached logs | 6 requests, all 502; 5 missing-config logs, 1 without attached logs |
| outbox-worker       | 15 requests, all 502; 13 missing-config logs, 2 without attached logs | 6 requests, all 502; 5 missing-config logs, 1 without attached logs |
| provider-intake     | 9 requests, all 502; 7 missing-config logs, 2 without attached logs   | 3 requests, all 502; all missing-config logs                        |

Both queries returned complete single pages. Attached logs show “Supabase is not configured.” at the same old service-client initialization boundary reviewed previously. No successful worker response, database access, provider activity or message delivery was observed. Requests without attached logs are retained as an evidence limit; their 502 responses are not represented as independently logged initialization failures. Sample IDs/timestamps are retained in the receipt.

The postflight window is 11:05–11:12 a.m. Eastern and includes the next five-minute and ten-minute boundaries. The draft's schedule entries are declarations, not proof of activation. The published-only scheduling model, actual preview/unpublished metadata, unchanged old publication, and continuing old failure pattern support non-activation of the new draft. No worker was called to prove it. [Netlify scheduled-function behavior](https://docs.netlify.com/build/functions/scheduled-functions/).

Residual risk remains the old active failing cadence and associated usage; this deployment did not disable it or permanently attest every historical credential. Any future containment/re-enable or worker-acceptance action requires its own scope and authorization.

## Remaining prerequisites and stop checkpoint

Supabase Auth Site URL and redirects were **not changed**. The previously verified localhost/empty configuration remains a readiness limit. A separately approved configuration can now use the real host:

```text
site_url = https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app
additional_redirect_urls = [
  https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app/auth/callback,
  https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app/auth/callback\?**
]
```

Do not push these settings without separate authorization. The reviewed generator can consume a private external copy of the verified receipt, followed by a minimal two-property config diff/review; no generated config or push was performed here.

Protected Playwright first-login checks still require separate approval and a normal Netlify team session for that browser; the in-app browser's existing session is not transferable proof. Full hosted acceptance additionally needs the reviewed perimeter-aware fixture/API/browser harness, approved synthetic mutations/cleanup, both query modes, responsive/accessibility review and provider-specific credentials/authorization. Only query mode true is deployed. Another build/deployment is not implied by this one-attempt authorization.

No migrations, Auth changes, synthetic sign-ins, fixtures, financial/bulk commands, invitations, resets, messages, provider calls, worker invocations, containment, merges, main pushes, production operations or Wave 2 work occurred. The application and Linux checkout remain at the authorized pin. Documentation-only PR #46 updates retain `[skip netlify]`, stopped automatic builds and the existing dependent base.

Repository formatting, credential scan and whitespace checks passed for this documentation checkpoint. Application/runtime/dependency/migration inputs still exactly match the application pin; no additional application test or financial acceptance pass is implied.

**Stop here.** The draft is created and read-only verification passed. Publication, full hosted acceptance and production remain NO-GO until their separate gates and authorizations are satisfied.
