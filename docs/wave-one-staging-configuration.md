# Wave 1 staging configuration: execution checkpoint

October 16, 2026 (Eastern). **BLOCKED before synthetic setup, Netlify credential configuration and deployment. Production remains NO-GO.** This records authorized staging work and its actual result, rather than treating the earlier proposal as current infrastructure state. No Wave 2 work is included.

Source: the user's October 16 resume instructions; [integrated acceptance](wave-one-integrated-acceptance.md); [staging proposal](wave-one-staging-proposal.md); [master plan](studio-portal-modernization-master-plan.md); [release-safety instructions](release-safety.md). Exact machine-readable applied history and checkpoint facts are retained in [wave-one-staging-checkpoint.json](wave-one-staging-checkpoint.json).

## Verified targets and authorization

| Item                                 | Actual current state                                                                                                                                                                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase staging                     | `coachd-staging`, **`lrxrivfqjpkvygozphoz`**, `https://lrxrivfqjpkvygozphoz.supabase.co`, organization `rxzyygvgbjozomkgocnu`, `us-west-1`, PostgreSQL `17.11.0.003`, GA, `ACTIVE_HEALTHY`                                                                             |
| Cost                                 | User reports the isolated Free project was created after an actual $0/month quote. Project existence/region/status independently verified. No new resource, region change or billing change performed in this run                                                      |
| Netlify staging                      | `coachd-staging`, **`d83ff6cb-f57b-4741-8c3c-3eaae7adab19`**                                                                                                                                                                                                           |
| Access protection                    | Authenticated connector confirms `requiresSSOTeamLogin=true`, scope `all`; preserved. User separately reports an incognito login gate. No fresh authenticated perimeter browser journey performed in this run                                                          |
| Current hosted environment inventory | Only `E2E_FIXTURE_TOKEN`, function scope, deploy-preview context. **Zero Stripe variables**; no Google or Supabase variables. Existing token not used, rotated or exposed                                                                                              |
| Existing published staging deploy    | `6ace53e7f850061d7c49b711`, pre-Wave 1 commit `6df35d700cc13d60ceab3e92293635575479ec4d`, `production` context; unchanged                                                                                                                                              |
| Automatic-build risk                 | Git-connected to `main`, allowed branches `[main]`, `stop_builds=false`; PR/automatic skip flags unspecified, publication lock unspecified. No freeze or build-policy change was made. Complete policy/hook/queue review remains required before injecting credentials |
| Execution authority                  | Exact 57 reviewed staging migrations and isolated staging configuration authorized; deployment, provider activity, scheduled-worker activation, paid infrastructure and production operations excluded                                                                 |

Every remote database command in this run explicitly targeted `lrxrivfqjpkvygozphoz`. Write commands also used a guard refusing any other target, particularly production `htwthzshhilrjtqwprlo`. No existing local project link was accepted as authority. No production database query or mutation was performed.

The complete application candidate remains **`fe63c57e928bca78c23e43877480b36a2d8e26c6`**. PR #44 remains the documentation dependency at `5be0de2a8a2dc3563ceac80f1a197f75cba24bb4`. GitHub reinspection confirmed PRs #36, #37, #38, #39, #40, #42, #43 and #44 are open drafts at the exact heads recorded in the proposal; no dependency was merged or retargeted. This follow-up branches from #44, not a moving application branch.

## Initial discrepancy and verified correspondence

The staging history initially contained exactly one entry:

```text
version: 20261016122917
name:    202607030001_core
```

Its `statements` array contained the complete core migration in one item. The original reviewed identity is `202607030001` / `core`. The RLS migration was absent: zero public policies, all 25 core tables with RLS disabled, and no RLS helper functions. All 25 tables were empty, with zero Auth users and storage objects.

Before repairing history:

1. Compared recorded SQL with `git show fe63c57e928bca78c23e43877480b36a2d8e26c6:supabase/migrations/202607030001_core.sql`. They matched after removing transport/checkout line-ending differences and outer whitespace. The normalized SHA-256 is `80ea1035675d034a1f96a3793e2678f62883cef40a7846e94be77f87b35c91e6`.
2. Replayed core only in a local PGlite instance with a minimal `auth.users` reference. Compared the actual staging catalog with that result: **25 tables, 243 columns including defaults/nullability, 104 constraints, 61 indexes and 58 enum labels matched**. PostgreSQL-version-specific NOT NULL constraint catalog entries were excluded from the constraint comparison; column nullability was compared separately. The extension creation was omitted only in the PGlite probe, which provides UUID generation itself; no hosted SQL was changed for this comparison.
3. Verified all 57 local migration files match the pinned candidate after line-ending normalization, and the first 51 identities match the production-prefix manifest. The six Wave 1 files were not replaced or edited.

That established a one-to-one correspondence between the fully committed core schema and its reviewed migration. No blind core replay or blanket history marking occurred.

## Supported history repair actually executed

Using repository Supabase CLI **2.117.0**, with explicit staging ref and target guard:

```powershell
$stageProjectRef = 'lrxrivfqjpkvygozphoz'
if ($stageProjectRef -eq 'htwthzshhilrjtqwprlo' -or
    $stageProjectRef -ne 'lrxrivfqjpkvygozphoz') {
  throw 'Staging target guard refused'
}
npx supabase migration repair 20261016122917 --status reverted --linked --project-ref $stageProjectRef --yes
if ($LASTEXITCODE -ne 0) { throw 'History repair stopped' }
npx supabase migration repair 202607030001 --status applied --linked --project-ref $stageProjectRef --yes
if ($LASTEXITCODE -ne 0) { throw 'History repair stopped' }
```

Both commands succeeded. The old generated entry is absent; the original entry is now `202607030001` / `core`. This changed migration metadata only; it did not drop/recreate core tables. The pre-repair SQL and catalog inspection were retained outside the repository for comparison. [Supported migration-history repair](https://supabase.com/docs/reference/cli/supabase-migration-repair).

A guarded `db push --dry-run --skip-vault` then identified exactly 56 pending files, beginning with RLS and excluding core. The authorized `db push --skip-vault` applied 34 additional migrations before encountering the failure below. No seeds, custom roles or vault configuration were requested through the CLI flags.

## Exact stopping point: CRLF-sensitive legacy repair

Final history contains **35 of 57 migrations**, exactly the first 35 repository version/name pairs. The last applied migration is:

```text
20260903153607_unified_inbox_and_undoable_manual_email.sql
```

The next migration failed and **is not recorded as applied**:

```text
20260903161123_repair_legacy_procedure_lint.sql
SQLSTATE P0001
Expected redundant i declaration was not found in command_make_lesson_recurring
```

The Windows checkout uses `core.autocrlf=true`. Its CRLF bytes were preserved when earlier migration SQL created the function. The legacy repair explicitly searches `pg_get_functiondef` for `E'  i integer;\n'`. Read-only inspection proves the discrepancy:

| Probe on `public.command_make_lesson_recurring` | Result        |
| ----------------------------------------------- | ------------- |
| CR characters in `prosrc`                       | 61            |
| LF characters in `prosrc`                       | 61            |
| Position of LF-only declaration                 | 0 — absent    |
| Position of CRLF declaration                    | 438 — present |

This is a real execution failure, not a permission rejection, missing RLS migration or reason to mark the failed migration successful. The LF/CRLF distinction was treated as harmless during the initial core correspondence check; this later text-based repair makes it operationally significant. The unchanged Linux CI migration replay did not exercise this Windows input form. No historical file was modified, guard removed, migration skipped, function patched or failed push retried.

**22 migrations remain, including all six Wave 1 migrations.** A later LF-only execution checkout alone will not repair the already stored CRLF function body. Recovery needs an explicitly reviewed staging-only correction before resuming the existing chain; it must not hide this state behind a new history timestamp.

## Intermediate security and data state

After failure, fresh read-only checks confirm:

- 51 public tables, **all 51 with RLS enabled**, and 76 public policies. The second migration did succeed during this run; its previous safety-blocked attempt was not assumed successful.
- Zero students, Auth users, outbox messages and storage objects. No synthetic acceptance profile was created.
- One repository-created default studio exists: `11111111-1111-4111-8111-111111111111`, slug `stage-story`, name `Stage & Story`. This is migration seed/configuration content, not a production data import. It is **not** the requested `coachd-staging` acceptance profile and has not been connected to Netlify.
- The security advisor reports three informational RLS-without-policy tables (`idempotency_keys`, `public_endpoint_rate_limits`, `webhook_events`) and ten authenticated SECURITY DEFINER execution warnings. These require interpretation against the completed schema's intended service/helper access; do not add policies or revoke required helper access merely to silence warnings. [RLS diagnostic](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [function-execution diagnostic](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

This is **not a completed security acceptance**. Final private-schema grants, anonymous permissions, credit/booking/bulk infrastructure, advisor disposition, drift, generated types, pgTAP and real concurrency checks remain unverified against the final staging schema because it does not yet exist. The prior PR #43 results remain evidence for its isolated candidate; they do not turn this failed installation into a pass.

## Recovery proposal — not executed

The safest next action is review of a narrowly scoped staging recovery, retaining all records and the original migration chain:

1. Freeze the 35-entry history and function definitions/owners/ACLs before any correction. Prove the target recurring function, normalized to LF, matches the definition obtained from replaying the pinned first 35 migrations in an LF-only disposable PostgreSQL 17 environment.
2. In that disposable environment, reproduce the CRLF failure, then test a transaction that normalizes **only the verified recurring function definition's CRLF to LF** with exact identity/body preconditions. Preserve signature, owner, ACL, security mode and configuration. Validate no business SQL or string content changes beyond the reviewed line endings. Roll back on any unexpected definition, overload or grant change.
3. Review that concrete recovery SQL and its regression evidence before applying it to staging. This would be a correction beyond executing the 57 files unchanged; no such additional mutation was performed under this run's migration authority. Do not reset/recreate the database or reapply 35 migrations as a shortcut.
4. Execute remaining migrations from a byte-verified **LF-only export of the pinned Git objects**, not an autocrlf working tree. Resume at the failed file through normal CLI history tracking, never by marking it applied. Reinspect history after any failure. Consider a separately reviewed line-ending preflight to prevent recurrence; no `.gitattributes` or application candidate change was made here.
5. Once all 57 exact identities pass, perform final schema/RLS/private-grant/anonymous/advisor/type verification and applicable pgTAP/concurrency checks in their guarded disposable environment. Only then create the small synthetic staging studio and roles and proceed to approved configuration.

If the exact normalized correspondence cannot be established, stop and retain this database for review. No broad function rewrite or reset is proposed as an automatic fallback.

## Netlify configuration and deployment gates

No staging keys were retrieved or installed after the migration failure. The original fixture token remains unchanged, and the existing deployed function snapshots were not rebuilt. The removal of Stripe variables from current configuration does not prove old published snapshots have no credential material; do not invoke those workers for acceptance.

After migration recovery and verification, the configuration work still needs to:

1. Restrict/freeze automatic build/publication paths, inspect queue/hooks and confirm unrelated PRs/main cannot obtain the new staging credentials. Preserve team-login protection for all deploys; do not replace it with a weaker gate.
2. Retrieve only staging project client/service credentials and scope browser values to builds, server secrets to functions, and all values to the exact approved non-production deployment context. Rotate the fixture token securely, matching only the synthetic studio UUID. No secret is to be committed or put into a `VITE_` service-role variable.
3. Configure the synthetic studio only after schema success; validate coach/student/guardian boundaries and no real-recipient/provider configuration. Do not silently accept the seeded `stage-story` fallback.
4. Retain the proposal's outstanding guards: production-context origin hardcoding, perimeter-aware harness access, restricted Stripe test-key detection, protected webhook delivery and enforced email test-recipient control. No providers are authorized yet.
5. Present an immutable staging deployment package for **separate approval**: site `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`, exact candidate `fe63c57e928bca78c23e43877480b36a2d8e26c6` unless a new candidate is explicitly reviewed, protected unpublished/non-production context, approved query mode and actual trusted URL/metadata checks. No timers or provider dispatch. Do not deploy the current partial schema.

## Delivery and remaining acceptance

Completed: fresh infrastructure/GitHub verification, exact core/schema correspondence, supported history repair, 34 further successful migrations, failure diagnosis, post-failure security/data inspection and a version-exact 35-entry checkpoint. Documentation format, credential scanning, whitespace checks and checkpoint-prefix consistency are the applicable checks for this follow-up.

Not completed: migration recovery and final 22 files, full staging security/types/tests, `coachd-staging` synthetic profile, staging credential rotation/configuration, protected hosted browser tests, provider acceptance, actual worker cadence, human coach sign-off or release approval. Nothing was deployed, no provider credential restored, no worker invoked/activated, and no production configuration/data changed. The full Wave 1 through Wave 6 roadmap and PR 1.4–1.6 behavior remain preserved.

**Checkpoint:** stop for review of the exact CRLF recovery. Production remains NO-GO; deployment is not authorized.
