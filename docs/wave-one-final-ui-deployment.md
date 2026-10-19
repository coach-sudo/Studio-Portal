# Wave 1 final UI protected staging deployment

October 18, 2026, Eastern. **Deployment A verified. Production remains NO-GO.**

This documentation-only checkpoint is directly based on draft [PR #54](https://github.com/coach-sudo/Studio-Portal/pull/54), branch `codex/wave-one-final-ui-candidate`, at `49a9451472914b2310f941873e6b5b47fa30f888`. Its application pin intentionally precedes that documentation/executor head. Fresh GitHub reads confirmed all 18 reviewed dependency PRs remain open drafts at their recorded heads, including unchanged #53. No application, migration, dependency or executor code changed here. The [verification record](wave-one-final-ui-deployment.json) and [complete static/function hashes](wave-one-final-ui-deployment-artifacts.json) contain sanitized evidence; credentials, browser state, raw platform responses, build ZIPs and logs remain outside Git under Owner/SYSTEM protection.

## Actual deployment

Immutable deployment: **[6ad4c3817ca9519157e3e3b0](https://6ad4c3817ca9519157e3e3b0--coachd-staging.netlify.app)**.

| Property                   | Verified value                                            |
| -------------------------- | --------------------------------------------------------- |
| Application                | `f5324b203387a158df3c050569b95a9044368bc0`                |
| Netlify site               | `d83ff6cb-f57b-4741-8c3c-3eaae7adab19` / `coachd-staging` |
| Supabase project           | `lrxrivfqjpkvygozphoz`                                    |
| Synthetic studio           | `4ceff683-e72f-4b2e-96ce-85db2dca4eb2`                    |
| State / context            | `ready` / `deploy-preview`                                |
| Publication                | `published_at=null`; unpublished                          |
| Query flag                 | `VITE_QUERY_LAYER_V2=true`                                |
| Attempts / new deployments | 1 / 1                                                     |
| Functions                  | 23; all `nodejs22.x`; all uploaded digests match          |

The user authorized one deployment of the [reviewed candidate](wave-one-final-ui-candidate.md). The existing Linux x64 / Node `v22.22.0` environment used a clean detached checkout at the exact pin. Fresh `npm ci --no-audit --no-fund` preserved lockfile SHA-256 `c1de2bdb184e932b9647d5d0648e6243ed185b58f755f377e31031c7cabaa3e9`.

Independent packaging and a fresh official offline build passed before the single integrated Netlify CLI **27.8.0** build/upload:

```sh
netlify deploy --draft --context deploy-preview --site d83ff6cb-f57b-4741-8c3c-3eaae7adab19 --message "Wave 1 UI candidate f5324b203387a158df3c050569b95a9044368bc0" --json
```

A restricted, exclusive one-attempt marker was flushed before the CLI invocation. Its fresh official manifest postdates that marker. No expired manifest, Windows bundle, alias, production flag, source push/merge, or upload retry was used. `COMMIT_REF` came from verified Git HEAD; no `CONTEXT`, `URL`, `DEPLOY_URL` or `DEPLOY_PRIME_URL` override was supplied. Manual CLI metadata has `commit_ref=null`; source evidence combines the exact clean checkout, build artifacts and protected release verification.

All **117 client assets** match the independent build. All **124 actual static files** match the common files in the earlier 125-file preparation receipt; its additional `bundle-size-report.json` was a local diagnostic generated after the build and was cleared by the fresh integrated build. Do not reuse the old preparation artifact seal for a later hosted executor receipt. These are local artifact comparisons, not a claim that every served asset was authenticated and downloaded.

The uploaded invoice ZIP passed Linux ELF Sharp **0.35.5**, libvips **8.18.7**, font, path-safety and no-Windows checks. Extracted Sharp rendered the expected PNG; extracted invoice import/GET returned 405 with fetch disabled. The hosted invoice endpoint was not called. Largest JS is **111,672 gzip bytes / 130,000 cap**; CSS is **23,156 / 25,000 cap**, retaining the 22,000-byte warning. All **14 origin regression tests** passed freshly.

## Protection and preserved state

The supported Netlify project read verified team login for **all deployments** before and after upload. Anonymous `/` and `/api/healthz` each returned **401**. After the user completed normal Netlify team login, the exact-host perimeter-only session read `/api/healthz` with HTTP **200**:

```json
{
  "status": "ok",
  "release": {
    "commit": "f5324b203387",
    "context": "deploy-preview"
  },
  "checkedAt": "2026-10-18T13:11:30.382Z"
}
```

No Coach'D application login was performed. Health proves release identity and liveness; it does not verify the service secret, authenticated commands, provider delivery or runtime `DEPLOY_URL`. The CLI supplied no URL override, and platform metadata independently identifies the immutable origin. A final post-health read-only check again verified Auth, environment, publication, prior draft, original accounts and all 215 business rows.

- Published staging deployment remains `6ace53e7f850061d7c49b711`. Previous protected draft `6ad39275e099502cb54a8f64` retains identical full metadata and remains ready, preview and unpublished.
- Automatic builds remain stopped; zero active builds, build hooks or shared-team variables. Exactly ten preview-only variables are unchanged by per-key full-response digest. Service and fixture secrets remain function-only; provider credential names remain absent.
- Supabase Auth's full-response digest is unchanged. Site URL remains `https://6ad39275e099502cb54a8f64--coachd-staging.netlify.app`; its exact callback pair remains installed.
- Verified direct database TLS and hostname checks passed. The accepted schema seal and **57 migrations** are unchanged. All **215 rows across 76 business tables**, including all 37 original rows and retained H01–H16 evidence, match the reviewed baseline. The completed journal hash/chain is intact; its executor was not instantiated or rerun.
- All four manual accounts remain confirmed with their intended roles. The retained H coach remains banned and without memberships; the other three H identities remain absent.

Read-only existing logs contained 20 samples per legacy published worker, all 502, with a configuration-failure sample for each: **“Supabase is not configured.”** These timers remain declared; they were not disabled or invoked by this work. Unpublished previews do not activate their schedules ([Netlify documentation](https://docs.netlify.com/build/functions/scheduled-functions/)). This preserves the reviewed containment state and does not claim permanent timer deactivation or provider acceptance.

The initial post-deployment verifier expected a fixed 20-item list to retain all 20 prior entries after adding one. A larger read-only page verified the new deployment plus all 20 prior entries and exactly one creation after preflight. This was a pagination correction; no deployment was retried.

## Proposed next Auth update — not applied

Only after separate explicit authorization, replace staging Auth URL properties with:

```text
Site URL:
https://6ad4c3817ca9519157e3e3b0--coachd-staging.netlify.app

Redirect allowlist, exactly:
https://6ad4c3817ca9519157e3e3b0--coachd-staging.netlify.app/auth/callback
https://6ad4c3817ca9519157e3e3b0--coachd-staging.netlify.app/auth/callback\?**
```

The second entry has one literal backslash before `?`; the reviewed helper doubles it inside a TOML double-quoted string. No old host, localhost, production URL, broad host wildcard or additional callback is proposed. The actual verified receipt and explicit full application pin were passed to `prepare-auth-config.mjs`, which prepared minimal TOML in the restricted local deployment directory. It was not pushed. After separate approval, inspect a minimal remote diff limited to `site_url` and `additional_redirect_urls`; do not apply a change that touches unrelated Auth properties.

No publication, Auth/environment update, application sign-in, hosted business mutation, H rerun, UI01–UI09 run, provider call, message, worker invocation, merge, production operation or Wave 2 work is included. Leave the unpublished draft unused if a later gate fails; keep the old publication and Auth configuration. Hosted UI acceptance requires its own authorization, actual new deployment/artifact seals and fresh safety proofs. **Stop after Deployment A verification.**
