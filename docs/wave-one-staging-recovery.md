# Wave 1 staging recovery and configuration checkpoint

October 16, 2026 (Eastern). **Staging database and environment configuration complete; application deployment awaits explicit authorization. Production remains NO-GO.** This supersedes the blocked installation status in the [initial execution report](wave-one-staging-configuration.md). The [machine-readable checkpoint](wave-one-staging-checkpoint.json) contains all 57 final migration identities.

The user's PR #45 recovery instructions authorized the exact-function correction after isolated testing, the remaining reviewed migrations, synthetic configuration, staging build restrictions and credential configuration. No merge, deployment, provider activity, worker activation, billing change or Wave 2 work was authorized or performed.

## Targets and candidate

- Supabase: `coachd-staging`, **`lrxrivfqjpkvygozphoz`**, `us-west-1`, GA PostgreSQL `17.11.0.003`, Free organization `rxzyygvgbjozomkgocnu`.
- Netlify: `coachd-staging`, **`d83ff6cb-f57b-4741-8c3c-3eaae7adab19`**. Team-login protection remains enabled for **all deployments**.
- Application candidate: **`fe63c57e928bca78c23e43877480b36a2d8e26c6`**, unchanged PR #43 head. Application code and historical migrations were not edited by this recovery.
- PR #45 continues directly from #44 `5be0de2a8a2dc3563ceac80f1a197f75cba24bb4`. Reinspection confirmed the complete draft dependency chain remained unchanged before recovery. Production project/site were never targeted.

## Root cause and exact recovery

The initial 35 installed migrations were preserved. Stored `public.command_make_lesson_recurring(uuid,integer,text,integer,text)` contained 61 CRLF pairs from a Windows autocrlf checkout. The next migration searched for the LF-only declaration `E'  i integer;\n'` and intentionally raised `P0001` when it could not find that text. An LF-only export alone could not change an already stored function body.

The complete correction actually executed is [recover-recurring-crlf.sql](../scripts/staging/recover-recurring-crlf.sql). It is an authorized staging recovery script, **not a new migration**. It requires the exact 35-entry history hash, exactly one overload and the exact identity, owner, ACL, security mode, configuration and definition hashes. It performs only CRLF → LF normalization, verifies every other `pg_proc` property is unchanged, and commits transactionally. It refuses execution after the migration history advances.

| Evidence at the 35-migration recovery boundary                        | SHA-256 / result                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Inspected raw function definition                                     | `d0681ba4709e1cc6fc7c96e338f98e6f2b41e16a2b7f16eb7f3d4d81223b74bc`  |
| Normalized definition from independent PostgreSQL 17 replay           | `67563f49127d6aaec3c6eb97447a5b54d290b8e8232b234331294cbaac57adfe`  |
| Ownership/ACL/security/configuration/OID and other catalog properties | Unchanged; only `prosrc` line endings differ                        |
| Hash of unrelated public/private/auth/storage function catalog rows   | Identical before and immediately after recovery                     |
| Migration history during correction                                   | Still exactly 35 entries; no fabricated timestamp or applied marker |

The first implementation attempted an explicit `pg_proc` catalog lock. Managed Supabase denied that lock with `42501`; the transaction rolled back before changing the function. The successful implementation uses supported owner-level `ALTER FUNCTION` to reassert the **already verified identical search path**, acquire the target's write lock, then recheck the entire row before replacement. No system-catalog privilege was granted. Under actual concurrent catalog updates PostgreSQL can abort with `tuple concurrently updated`; testing confirms rollback and a fresh verified retry, rather than lost updates. An exact repeated correction is a no-op while its 35-entry precondition still holds.

The successful command was explicitly guarded against production and bound to staging:

```powershell
$stageProjectRef = 'lrxrivfqjpkvygozphoz'
if ($stageProjectRef -ne 'lrxrivfqjpkvygozphoz' -or
    $stageProjectRef -eq 'htwthzshhilrjtqwprlo') { throw 'Target refused' }
npx supabase db query --linked --project-ref $stageProjectRef `
  --file scripts/staging/recover-recurring-crlf.sql --output json
```

Do not rerun that script against the completed database: its historical preconditions now correctly reject it, and later migrations intentionally replace the recurring command with the final Wave 1 implementation.

## Disposable PostgreSQL 17 proof

There is no configured Docker/Podman distribution on this host after reboot. The native test runtime is PostgreSQL **17.10**, supplied by pinned `@embedded-postgres/windows-x64@17.10.0-beta.17`, with `pg@8.16.3`, installed outside the repository with package lifecycle scripts disabled. It creates a temporary cluster, listens only on `127.0.0.1:56435`, installs no Windows service, and stops the cluster in cleanup. No cloud database URL is accepted by the test transport.

The [recovery test runner](../scripts/staging/test-recurring-crlf-recovery.mjs) replays the pinned migrations and uses a **non-superuser function owner** for the recovery. Its Auth/Storage schemas are explicit local compatibility bootstrap definitions, not live Auth/Storage services. Those platform boundaries are additionally tested through the actual staging API below.

Confirmed regression results:

- Original, unchanged historical migration reproduces the CRLF failure.
- The LF-normalized staging definition equals the independently replayed pinned definition.
- The recovery preserves all catalog properties except normalized source, all unrelated functions, and actual recurring-lesson behavior.
- Exact repeat is a no-op. Unexpected overload, search-path drift and definition drift are rejected.
- Separate sessions demonstrate lock contention and safe abort/retry under a competing owner DDL write.
- The original historical repair succeeds after correction; the complete original 57-file chain then replays successfully.
- **204 pgTAP assertions across all eight existing SQL files passed.**
- **All three concurrency suites passed**, including observed contention for grant/replay, cancellation/coverage, reviewed execution, stale calendar completion, booking withdrawal, late FK/JSON dependencies, bulk replay, frozen reviews and deletion identity reuse.

The concurrency harness retains each pinned script's scenario body and assertions, adapting only its Docker/psql transport to the guarded loopback PostgreSQL 17 connection. [The bridge](../scripts/staging/pg-client-bridge.mjs) verifies major version and a disposable-cluster marker, preserves psql-style statement boundaries and value formatting, and has no linked/remote connection option. Early transport attempts exposed sentinel buffering and scalar Boolean/JSON formatting differences; those harness defects were corrected without changing the scenario assertions.

Reproduction prerequisites are an isolated runtime directory containing the pinned native packages, the frozen pre-recovery `staging-before.json` inspection, and pgTAP **v1.3.4** SQL/control files from the [upstream source](https://github.com/theory/pgtap/tree/v1.3.4). pgTAP is installed only in this disposable runtime; the application lockfile is unchanged. Run the LF reference first if reconstructing the runtime, then the CRLF regression:

```powershell
$env:STAGING_PG_RUNTIME_DIR = 'C:/Users/dariu/.codex/tmp/studio-pg17-runtime'
# With REPLAY_CRLF unset: generate the independently compiled LF reference.
node scripts/staging/test-recurring-crlf-recovery.mjs
$env:REPLAY_CRLF = 'true'
node scripts/staging/test-recurring-crlf-recovery.mjs
Remove-Item Env:REPLAY_CRLF
Remove-Item Env:STAGING_PG_RUNTIME_DIR
```

The normal `supabase test db --linked` wrapper could not start its Docker-backed test runner. No hosted pgTAP pass is claimed. The same eight SQL test files passed on the native disposable database, followed by actual hosted schema/privilege and authenticated API checks. No container safety guard was removed from an existing repository script.

## Completed staging migration and schema verification

Executable migration input was exported directly from the pinned Git blobs into an outside-repository workdir. All **57 migration files** were byte-checked against those blobs and rejected if containing CR bytes. The six Wave 1 working-file hashes also matched the proposal before recovery; the executable export uses canonical Git LF bytes.

After verifying the dry run listed exactly the remaining 22 files, the ordinary CLI applied them with `--project-ref lrxrivfqjpkvygozphoz --linked --skip-vault --workdir <verified-LF-export>`. The failed historical migration succeeded under its original `20260903161123` version. Final history is **exactly all 57 expected version/name pairs**, ending with `20261015123428_student_workspace_summary`. The first 35 identities are unchanged. A subsequent dry run reports **up to date, zero pending migrations**. No reset, completed-migration replay, historical SQL edit, vault update or production import occurred.

| Final gate                                           | Result                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Generated public TypeScript types                    | Exact parity with committed types after the repository's normal metadata removal/line-ending normalization                           |
| Schema comparison against disposable PG17 replay     | Exact match: **78 application/internal tables, 1,041 columns, 488 constraints, 233 indexes, 151 functions with ACLs, 97 policies**   |
| Public tables                                        | **67/67 RLS enabled**, 95 public policies; no invalid/unready application indexes                                                    |
| Internal queues and ledgers                          | Expected final tables/grants match replay; no direct anonymous access; raw private schemas rejected by the hosted Data API           |
| Financial/operational records before synthetic setup | Zero students, Auth users, lessons, ledger entries, payments, outbox messages, credit jobs and bulk jobs                             |
| Full migration, financial and concurrency regression | 204 pgTAP assertions and all three separate-session suites pass locally; final hosted schema/types and API authorization checks pass |

The [schema fingerprint query](../scripts/staging/schema-fingerprint.sql) compares authored schemas and normalizes function line endings for semantic parity. Local bootstrap default function grants were aligned with the observed Supabase platform defaults; no hosted grant was changed to force parity. Platform-managed Auth/Storage implementation internals and external providers are outside this schema comparison.

### Advisor dispositions

No advisor finding was hidden or automatically fixed by broadening policies or revoking intended RPC access:

- **13 informational RLS-without-policy tables:** internal coverage, bulk, receipt/audit-support and public service-operation tables intentionally deny client row access. Existing grants and guarded-facade tests establish the intended service path. [Diagnostic](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- **11 authenticated SECURITY DEFINER warnings:** existing row-authorization helpers, guarded lesson completion/update commands and coach visibility helper. Definitions and ACLs match the reviewed chain; negative-role regression and hosted summary access checks pass. These remain explicit review findings, not a claim of a warning-free project. [Diagnostic](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- Performance: **80 unindexed-FK informational notices, 86 unused-index informational notices, four Auth RLS initplan warnings and 24 multiple-permissive-policy warnings**. Retain for realistic staging sizing/acceptance; do not add unrelated index/policy migrations during recovery. [FK guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [initplan guidance](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan), [policy guidance](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

## Synthetic profile and actual hosted authorization

Created studio **`4ceff683-e72f-4b2e-96ce-85db2dca4eb2`**, slug **`coachd-staging`**, one adult synthetic student (`be0657a3-0f36-477a-949a-491afb24809c`), one linked guardian, and four admin-confirmed Auth identities: coach, student, guardian and unrelated. Addresses use only `coachd-staging.example.test`; no invitation/reset email was sent. Contact notifications are disabled. Financial balances and coaching history remain empty; fixtures for actual lesson/financial acceptance are deferred to the approved hosted run.

Using actual staging password sessions and RLS-backed API calls, verified:

- Coach, student and authorized guardian can read the permitted financial overview.
- Only the coach can read the coach workspace summary; student, guardian and unrelated identities are denied.
- Anonymous and unrelated finance reads are denied.
- Revoking guardian access denies finance with its unchanged JWT; restoring the synthetic contact restores authorized access.
- Anonymous requests for `credit_internal` and `lesson_ops` profiles return `PGRST106`: these schemas are not exposed by the Data API.

Synthetic passwords and the rotated fixture token are retained only in owner/SYSTEM-restricted files outside Git under the local disposable runtime directory. No service key or user password appears in this report, the checkpoint JSON or source. API checks are **not** an authenticated hosted-browser journey.

The repository-created `stage-story` studio remains as migration seed content; it is not selected by any new staging environment variable. No production student, guardian, payment, material or message was copied.

## Netlify configuration actually applied

Restricted the **staging site only** with `build_settings.stop_builds=true` through the official CLI. Rechecked zero active builds (96 historical build records inspected) and zero build hooks. Shared-team environment inventory is empty. All-deploy team-login protection remains enabled. The current published deploy remains **`6ace53e7f850061d7c49b711`**; no rebuild, upload or publication occurred.

| Keys                                                                             | Scope     | Context               | Secret                           |
| -------------------------------------------------------------------------------- | --------- | --------------------- | -------------------------------- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_QUERY_LAYER_V2`             | Builds    | `deploy-preview` only | No; public browser configuration |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `STUDIO_SLUG`, `STUDIO_ID`, `E2E_STUDIO_ID` | Functions | `deploy-preview` only | No                               |
| `SUPABASE_SERVICE_ROLE_KEY`, rotated `E2E_FIXTURE_TOKEN`                         | Functions | `deploy-preview` only | **Yes**                          |

All ten entries were read back for scope/context/secret metadata. Both Supabase compatibility JWT keys were decoded in memory to confirm the staging ref and correct `anon`/`service_role` claims before use. No service key is a `VITE_` variable or build-scoped. Studio IDs resolve to the synthetic studio above. Initial query mode is `true`; the later approved acceptance build must also exercise `false` at the same candidate.

**No Stripe, Google, Gmail or `E2E_EPHEMERAL` entries are configured.** Current published function snapshots were not rebuilt; changed configuration must not be mistaken for a change to those snapshots. New credentials have no production/branch/all-context values and are not intended for that old published deployment. No scheduler or worker was invoked or activated by this work.

## Remaining deployment and release gates

The database/configuration checkpoint is ready for an **explicit deployment decision**, not deployment execution:

1. Authorize the exact Netlify staging site and immutable application SHA above, protected unpublished/non-production context and approved query-mode build. Keep automatic builds stopped; review the supported manual deployment path without broadening credential contexts or unlocking unrelated Git builds.
2. Verify actual build/deploy metadata and trusted origin agree. The unchanged candidate still maps any `production` context to the real production portal, so it must not be deployed to staging's production-context main domain. Stop if manual deployment cannot provide consistent non-production metadata; any runtime fix needs a newly reviewed candidate.
3. Establish the exact protected deploy URL and verify Supabase Auth Site URL/redirect allowlist before invitation, reset or OAuth journeys. These redirect settings were not changed in this checkpoint; only confirmed password-based synthetic API access is claimed.
4. Implement/review perimeter-session handling for every browser and fixture API context; never weaken team-login protection. Run both query modes, fresh responsive/accessibility journeys and cleanup/invariant checks against synthetic records only.
5. Providers remain blocked: isolated Stripe credentials/key-capability check and authenticated webhook ingress; isolated Calendar OAuth/calendar ID; fail-closed email sink/recipient controls. `GMAIL_ENABLED=false` is not a working delivery kill switch. No credentials or provider transaction are authorized by this report.
6. Actual scheduled cadence requires separate publication/activation approval; manual processing is a different acceptance gate. Human coach sign-off, integration review and all production release approvals remain required.

Production remains **NO-GO**. No PR was merged, no application was deployed, no provider credential was restored, no real recipient was contacted, and no production configuration or data was touched. The complete approved modernization roadmap remains intact; Wave 2 has not started.
