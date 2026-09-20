# Release safety and staging

The repository is the release source of truth. Production changes are published from a protected `main` commit through Netlify's Git integration; production must not be deployed from an unrecorded local CLI build.

## GitHub ruleset for `main`

Create a branch ruleset in **Repository settings → Rules → Rulesets** targeting `main`:

1. Require a pull request with at least one approval.
2. Dismiss stale approvals after new commits and require all conversations to be resolved.
3. Require the `Production checks / verify`, `Production checks / migrations`, and `Deployed browser checks / smoke` checks.
4. Block force pushes and branch deletion, require linear history, and apply the rules to administrators.
5. Do not grant direct-push bypasses for ordinary release work.

These settings are manual because repository configuration is outside the source tree.

## Netlify projects

Use two Git-connected Netlify projects for the same repository:

### Production

- Production branch: `main`.
- Automatic production deploys: enabled only for `main`.
- Deploy Previews and branch deploys: disabled in **Project configuration → Build & deploy → Continuous deployment → Branches and deploy contexts**.
- Environment variables: production browser-safe Supabase values and server-only production provider secrets.
- Do not put secrets in `netlify.toml` or GitHub Actions output.

### Staging

- Production branch: `main`; Deploy Previews: enabled for pull requests.
- Environment variables: dedicated staging Supabase project, Stripe test-mode restricted key and webhook secret, and an optional isolated Google test calendar/account.
- Never point staging at production Supabase, Stripe live mode, or the production Google account.
- Protect preview URLs with Netlify preview access controls when the plan supports them.

Netlify supplies `COMMIT_REF` and `CONTEXT`; Coach’D exposes only the shortened commit and context from `/api/healthz` and the coach-authenticated provider-health response.

## Supabase staging

1. Create a separate project and keep production data out of it.
2. Apply migrations in order and verify them with `npm run supabase:verify` against a local stack before pushing.
3. Keep `auto_expose_new_tables = false`; every exposed table must have explicit grants and RLS.
4. Store test identities and fixture records only in staging. Names must use the `e2e-` prefix and cleanup must be idempotent.
5. Generate committed database types with `npm run supabase:types` locally or `npm run supabase:types:linked` only against the intended non-production linked project.

Never run `supabase db reset --linked` against production.

## Stripe and Google staging

- Use a staging-specific Stripe restricted test key and test webhook endpoint. Keep the webhook signing secret server-only.
- Browser tests may create Stripe Checkout Sessions only in test mode. Tests that lack configured payment infrastructure must report `blocked`, not pass or silently skip.
- Google journeys require an isolated test calendar and least-privilege OAuth scopes. Until configured, Google-dependent journeys remain explicitly blocked.

## Rollback

- Revert the individual phase commit or pull request.
- Database migrations in this release are additive; leave new columns/tables in place while reverting application use.
- Set `VITE_QUERY_LAYER_V2=false` and redeploy the same protected commit to restore the legacy snapshot reader during its one-release compatibility window.
- A production deployment or environment-variable change always requires explicit authorization.
