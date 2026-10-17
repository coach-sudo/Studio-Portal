# Wave 1 protected staging candidate deployment

October 17, 2026 (Eastern). **The single authorized draft deployment is complete. Production remains NO-GO.**

## Result and dependency

Immutable deployment: **[`6ad39275e099502cb54a8f64`](https://6ad39275e099502cb54a8f64--coachd-staging.netlify.app)**.

| Property                            | Verified value                                            |
| ----------------------------------- | --------------------------------------------------------- |
| Application                         | `830c762bdaf085f5e20a91f4e6a7afbef4afa627`                |
| Netlify site                        | `d83ff6cb-f57b-4741-8c3c-3eaae7adab19` (`coachd-staging`) |
| Supabase project                    | `lrxrivfqjpkvygozphoz`                                    |
| Deployment state/context            | `ready` / `deploy-preview`                                |
| Publication                         | `published_at=null`; unpublished                          |
| Query mode                          | `VITE_QUERY_LAYER_V2=true`                                |
| Serverless functions                | 23; all `nodejs22.x`                                      |
| Deployment attempts/new deployments | 1 / 1                                                     |

This documentation-only checkpoint is directly based on draft PR #50, branch `codex/wave-one-staging-release-candidate`, at `1842f4f51a1cdad90d4605a7a3406f77a9cdf8d4`. The deployed application pin intentionally precedes that report/helper head. Fresh GitHub reads confirmed all thirteen inspected dependency PRs remain open drafts with their reviewed heads unchanged. Each implementation dependency is an ancestor of the application candidate; PR #50's final report head descends from that candidate.

[Deployment evidence](wave-one-candidate-deployment.json) records the actual receipt, protection, unchanged configuration, database checks and limits. [Artifact evidence](wave-one-candidate-deployment-artifacts.json) records all client/function hashes. The authorization and procedure are the user's single-deployment instruction and [PR #50's reviewed release report](wave-one-staging-release-candidate.md).

## Build and upload

The clean detached Linux checkout was verified at the exact application SHA. Ubuntu 24.04 x64 / Node `v22.22.0` installed dependencies with `npm ci --no-audit --no-fund`, preserving lockfile SHA-256 `c1de2bdb184e932b9647d5d0648e6243ed185b58f755f377e31031c7cabaa3e9`.

Fresh independent packaging verified the staging public URL/anon identity, V2 flag, release metadata, bundle budgets, Linux native files, font, and 23 function bundles. Netlify CLI **27.8.0** then performed one integrated fresh build and draft upload:

```text
netlify deploy --draft --context deploy-preview --site d83ff6cb-f57b-4741-8c3c-3eaae7adab19 --message "Wave 1 reviewed 830c762bdaf085f5e20a91f4e6a7afbef4afa627" --json
```

A private exclusive attempt marker was flushed before invoking the CLI. Its receipt and logs remain outside Git in the Owner/SYSTEM-restricted deployment directory. There was no retry or second deployment. `COMMIT_REF` came from verified Git HEAD; no `CONTEXT`, `URL`, `DEPLOY_URL` or `DEPLOY_PRIME_URL` override was supplied. Netlify selected the preview context and returned the actual immutable origin. No alias, production flag, push/merge deployment or old function cache was used.

The newly generated manifest postdates the attempt marker. All **23 hosted function digests match the local uploaded ZIP hashes**, names and Node 22 runtimes. All **117 local client assets match the independent staging build**. These client checks compare build artifacts; they do not claim an authenticated download of every served asset. Manual CLI deployment metadata has `commit_ref=null`; source identity is established by the clean exact checkout, artifact evidence, deployment title and protected health release marker.

The uploaded `invoice-pdf` bundle contains Linux ELF Sharp **0.35.5**, libvips **8.18.7** and the invoice font, with no Windows native artifacts. Extracted Sharp rendered a 32×16 PNG with SHA-256 `387684da1448471d0b16aa2db5e5f80ce6c0a790311ab6ead4802ceae02b3f1c`. The extracted module imported and returned 405 to a local GET with fetch disabled. The hosted invoice route was not invoked.

## Protection and health

The Netlify dashboard showed **Private** for both production and Deploy Preview visibility before and after upload. The supported project connector confirmed team login applies to **all** deploys. Independent requests without cookies returned **401** for both `/` and `/api/healthz`.

The existing authorized Netlify team browser session read only the new deployment's health route, without a Coach'D application login:

```json
{
  "status": "ok",
  "release": {
    "commit": "830c762bdaf0",
    "context": "deploy-preview"
  },
  "checkedAt": "2026-10-17T15:23:10.092Z"
}
```

Health is release/liveness evidence. It does not verify the database service credential, authenticated application commands or provider delivery. Health does not expose runtime `DEPLOY_URL`; no URL override was injected and the actual `deploy_ssl_url` matches the immutable origin. No additional application endpoint was invoked to inspect environment values.

## Preserved state

- Published staging deployment remains **`6ace53e7f850061d7c49b711`**. Previous protected draft **`6ad23d4f8b10c10447224155`** remains ready and unpublished.
- Automatic builds remain stopped, with zero active builds, build hooks or shared-team environment variables.
- Exactly ten preview-only variables retain their scopes, values and metadata. Service/fixture secrets remain function-only. Stripe, Google, Gmail and SMTP credential names remain absent. The environment API returns rows in variable order: putting the post-deployment rows into the recorded preflight order reproduces the exact original whole-response digest. An initial unsorted digest discrepancy was a verifier ordering issue; no environment update occurred.
- Supabase Auth configuration is unchanged by full-response digest. Site URL remains `https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app`; redirects remain that origin's `/auth/callback` and `/auth/callback\?**`. No new-host redirect was added.
- Read-only database checks before and after upload passed verified TLS/hostname checks, **57 migrations**, accepted schema seal `24828e13e95714c1c42a0734fc6a6dfcb63f33a2947734cdcdbeee751efca3f4`, and exact preservation of **215 rows across 76 tables**, including all **37 original rows** and retained H01–H16 evidence. The completed journal's hash chain and file digest are unchanged. The executor was not instantiated or rerun.

Existing worker logs were inspected without invocation: 18 samples each for booking maintenance, Calendar and outbox, and nine for provider intake in the inspected window all returned 502. Each worker has a fresh error sample showing **“Supabase is not configured.”** before database/provider access, consistent with the unchanged published snapshot. Their schedules remain declared; the new unpublished preview does not activate its schedules. This preserves the reviewed containment state and does not claim permanent timer deactivation or provider acceptance.

## Review boundary

No application role login, business write, fixture, H01–H16 rerun, Auth/environment update, provider call, message, worker invocation, publication, merge or production operation was performed. This checkpoint changes documentation only and leaves the application pin unchanged.

**Deployment verification: PASS. Stop here.** A minimal exact-host Auth update and subsequent protected role/browser acceptance need separate authorization. Hosted mutations, isolated providers, scheduled cadence, remaining accessibility acceptance and production release remain unapproved or incomplete as recorded in PR #50. Wave 2 has not begun.
