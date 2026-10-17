# H01–H16 synthetic mutation executor — review checkpoint

Prepared October 16, 2026. **No hosted mutation was executed. Production remains NO-GO.** This checkpoint depends directly on draft [PR #47](https://github.com/coach-sudo/Studio-Portal/pull/47), base `codex/wave-one-hosted-acceptance` at `3057d6cbdde6628a80d0c10b6ad9c6a323153592`. It changes the acceptance harness and documentation; it does not change the deployed application, migrations or provider behavior.

Delivered in draft [PR #48](https://github.com/coach-sudo/Studio-Portal/pull/48), directly based on PR #47's branch. The user-requested usage hold has ended. Final source/adversarial review added attempt/error detection, a consistent initial baseline snapshot, repeated approval-expiry checks, stricter Auth identity/method checks and a canonical-path check for private storage. Hosted execution is still unauthorized. The [resume notes](wave-one-hosted-mutation-executor-resume.md) preserve checkpoint history.

Read alongside the [hosted acceptance report](wave-one-hosted-acceptance.md), [reviewed proposal](wave-one-hosted-mutation-proposal.md), [76-table historical baseline](wave-one-hosted-business-verification.json), [master plan](studio-portal-modernization-master-plan.md), [integrated acceptance](wave-one-integrated-acceptance.md), [staging recovery](wave-one-staging-recovery.md), [deployment gate](wave-one-first-staging-deployment.md), [draft deployment](wave-one-staging-draft-deployment.md) and [Auth checkpoint](wave-one-staging-auth-configuration.md). Earlier approvals do not authorize this mutation lane.

## Exact scope and implementation

| Target                            | Required identity                                              |
| --------------------------------- | -------------------------------------------------------------- |
| Supabase                          | `lrxrivfqjpkvygozphoz`                                         |
| Netlify                           | `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`                         |
| Protected, unpublished deployment | `6ad23d4f8b10c10447224155`                                     |
| Origin                            | `https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app` |
| Deployed application              | `0b18a5a2238daa49bec1290f5884d5792f4aefc9`                     |
| Studio                            | `4ceff683-e72f-4b2e-96ce-85db2dca4eb2`                         |
| Run                               | `e2e-wave1-hosted-20261016-a`                                  |

The [entry point](../scripts/staging/hosted-mutations.mjs) defaults to an offline description. `--execute`, `--resume` and `--cleanup` require an explicit, unexpired, code-bound authorization receipt outside Git. No target, origin, studio, run or arbitrary SQL can be supplied on the command line. Starting a fresh run over an existing journal is refused.

Implementation modules:

- [policy](../scripts/staging/mutations/policy.mjs): deterministic IDs, ownership graph, target/endpoint allowlists, RPC signatures and budgets.
- [engine](../scripts/staging/mutations/engine.mjs): all 76 business tables, row preimages, transactional commit evidence, recovery, command journal and scoped processing.
- [cases](../scripts/staging/mutations/cases.mjs): H01–H16 commands and persisted assertions.
- [fixtures/cleanup](../scripts/staging/mutations/fixtures.mjs): bounded fixtures and ordered, exact-row removal.
- [hosted adapter](../scripts/staging/mutations/hosted.mjs): protected perimeter, staging-only Auth/Netlify/SQL access and credential handling.
- [journal](../scripts/staging/mutations/journal.mjs): private append/fsync, hash chain, exclusive local lock and code/manifest binding.
- [schema seal](../scripts/staging/mutations/seal.mjs): exact application catalog and non-internal trigger verification, including Auth triggers.
- [native validation](../scripts/staging/mutations/validate.mjs) and [offline guards](../scripts/staging/mutations/guards.node.mjs): disposable PostgreSQL and zero-network safety checks.

The read-only browser lane remains separate and unchanged. This executor calls the existing canonical PostgreSQL commands with the service role and the new coach identity. It does not call Netlify application mutation endpoints. In particular, the deployed HTTP rescheduling wrapper can call Google Calendar; it is forbidden here. H06 proves canonical SQL behavior, not provider-capable HTTP behavior. H16 proves bounded candidate selection, matching/exclusion freezing and recoverable progress reads; it does not certify browser selection controls, refresh routing or rendered results. Those remain browser acceptance work.

## Enforced budgets

Original proposal ceilings remain: **4 new Auth identities; 2 students; 13 seeded lessons plus at most 6 command-created lessons (19 total); 3 package lots; 12 granted credits; USD 100.00 synthetic cash; 1 pending invoice; 20 items per review; 100 canonical RPC requests.** No card, charge, payment method, external calendar identity or usable provider credential is created.

The implementation adds tighter supporting limits: two services, two bookings, two series, one class offering, one authored note, two synthetic reminder intents, nine bulk jobs and forty bulk items. All run-owned business rows, including retained audit and replay evidence, are capped at **512 distinct table/primary-key identities cumulatively**. Each table also has an explicit ceiling in `recordLimits`; `--describe` and the evidence JSON expose every ceiling. Grants are counted from positive purchase/adjustment ledger entries; released capacity cannot be used to exceed cumulative lesson or row budgets. Failed RPC attempts consume the request budget. Every SQL transaction checks budgets before commit and rolls back an overrun.

Normal local H01–H16 execution uses **68 canonical RPC requests**, six granted credits in one package, eighteen lessons (13 seeds + 3 creations + 2 additional recurring occurrences), two bookings, one zero-total pending invoice and one class. The paid shared-booking fixture records USD 100.00 of synthetic paid history; it performs no settlement. Remaining capacity is for explicit recovery with original keys, not extra scenarios.

## Reviewed command inventory

Full ordered command names, function names, stable keys and measured counts are in [sanitized local evidence](wave-one-hosted-mutation-executor-evidence.json). Review/lease tokens, passwords, raw records and sessions are excluded from that file.

| Case | Canonical operation and database assertion                                                                                                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H01  | Grant four credits; submit the same key twice. Same entry, one grant receipt, balance four.                                                                                                                                                  |
| H02  | Enable auto; create three lessons. Unique holds; remaining/reserved/available = 4/3/1.                                                                                                                                                       |
| H03  | Apply upcoming twice using the original key. Applied zero, already covered three, ledger unchanged. A local fault drops the first committed response and proves recovery without another first request.                                      |
| H04  | Complete a covered lesson twice with the same key and old version. Same replay result, net debit exactly one.                                                                                                                                |
| H05  | Reserve the return fixture; cancel with return. Returned debit funds the next uncovered lesson; unrelated hold stays.                                                                                                                        |
| H06  | Review/execute valid reschedule. Preview beyond expiry gives `reserved_credit_expires`; execution refuses `REVIEW_REQUIRED`, original reservation remains.                                                                                   |
| H07  | Grant two credits; convert an existing covered lesson into three weekly occurrences. New occurrences covered immediately; original hold preserved.                                                                                           |
| H08  | Cancel only the first occurrence of an actual two-occurrence series/shared booking. Sibling, reminder and projection unchanged; selected reminder cancelled; booking confirmed and series active.                                            |
| H09  | Shared prepaid cancellation review returns `shared_prepaid_review_required`; student-scoped class review blocked. Paid history and both participants remain.                                                                                 |
| H10  | Freeze four deletion candidates. Provider history and exact invoice/note dependencies block three; one dependency-free mistake eligible.                                                                                                     |
| H11  | Accept the review twice with one key; service-only claim/process. Eligible lesson physically absent, exactly one immutable deletion snapshot, protected records remain.                                                                      |
| H12  | Archive, restore, void through existing bulk commands. History remains; no delivery effects for these actions.                                                                                                                               |
| H13  | Increment one reviewed lesson version; execute the mixed batch. One conflict and one success.                                                                                                                                                |
| H14  | Process one sibling; expire only the other run-owned lease, reclaim through five attempts, then retry the failed item. Obsolete token rejected; sibling attempts stay one. No worker endpoint.                                               |
| H15  | Read as new guardian; revoke/restore its new contact. Reuse the same hosted JWT, requiring denied access while revoked and access restored afterward. Local validation tests the same authenticated SQL identity, not a local GoTrue server. |
| H16  | Two bounded candidate pages; freeze all-matching selection with provider exclusion; reload progress. Exact frozen IDs remain, excluded and deleted IDs absent.                                                                               |

Allowlisted functions are grant/settings/create/complete/recurring/reserve-upcoming, occurrence preview/execute, bulk preview/execute/claim/process/retry/progress/candidates. Direct SQL fixture writes are separately visible in `fixtures.mjs`. Additional direct changes are limited to activation of the two credit-return fixtures, H13's owned lesson version, H14's owned active lease timestamps, H15's owned guardian permission, per-operation audit commit markers and cleanup. There is no generic SQL or service RPC passthrough.

## Preflight and baseline enforcement

Before any fixture creation, the executor verifies the protected preview's health context and application pin, exact Netlify site/deploy identity, unpublished status, team-login protection for all deployments, stopped builds, unchanged legacy published deploy, empty shared team environment and exactly ten preview-only staging variables. Secret service/fixture variables must remain function-only. Unexpected provider variables stop execution.

It also reads only the exact staging project's [Auth configuration](https://supabase.com/docs/reference/api/v1-get-auth-service-config), requiring `auth_config_read` permission, to prove disabled creation/password/access-token hooks, no enabled external Auth provider or SMTP host, and the unchanged exact Site URL/two callback redirects. This closes the separate [Auth hook](https://supabase.com/docs/guides/auth/auth-hooks) outbound path. This live hook/provider check has **not** been run in this checkpoint and remains a fail-closed execution prerequisite; no Auth configuration is changed by the executor.

Direct SQL permits only `db.lrxrivfqjpkvygozphoz.supabase.co:5432`, database/user `postgres`, with verified TLS; no DSN override, production, pooler fallback or TLS weakening. The existing studio and exactly 57 migrations must remain. Application catalog verification includes definitions, ACLs, tables, columns, constraints, indexes, policies and non-internal application/Auth triggers. It is generated from the local 57-migration replay, never adopted from hosted drift.

On October 16, read-only staging inspection confirmed PostgreSQL **17.11**, all **57 migrations**, and the exact same SHA-256 schema seal as the native PostgreSQL 17.10 replay: `24828e13e95714c1c42a0734fc6a6dfcb63f33a2947734cdcdbeee751efca3f4`. Both reads use `search_path=pg_catalog`; deparser output otherwise changes qualification. Read-only comparison also reconfirmed **76/76 historical table fingerprints, zero changed tables**. Netlify still reports the exact ready, unpublished deploy-preview and all-deploy team login. This inspection performed no hosted writes.

After the usage hold, the schema seal and all 76 business fingerprints were reverified again without changes. Netlify readback reconfirmed stopped automatic builds, all-deployment protection, the exact ready/unpublished preview and unchanged legacy publication. Historical aggregate verification and capture of initial row preimages now occur in one read-only repeatable-read transaction; a two-session regression proves a writer between these reads cannot be silently re-baselined.

Initial provisioning refuses every planned UUID anywhere in the 76-table baseline, including JSON/array references, and every planned Auth ID. Each transactional operation verifies the target, schema and all pre-existing row hashes. New rows must satisfy the ownership graph, synthetic identities, studio, relations, currency, no-provider and no-attempt invariants. No original student, membership, contact, Auth identity, ledger or authored content is eligible for mutation. Changing a pre-existing row, an unknown run-owned row, an immutable receipt, a permission or a schema object stops execution.

Pre-existing Auth identities receive a separate baseline excluding only operational `last_sign_in_at` and `updated_at`. Session operational tables are outside the 76-table business inventory. All new Auth identities have fixed IDs and `.example.test` addresses; admin creation confirms them directly without invitation/OTP/reset/email flows.

Every owned Auth read/create result must also retain the exact email/ID/run marker, confirmation and ordinary `authenticated` role/audience. Role drift stops processing. Admin deletion is allowlisted only for the three identities intended for removal; PUT is permitted only for the retained coach. The written approval's expiry is rechecked on each preflight, not just process startup.

## Privileged cleanup review and blast radius

This was a separate source and adversarial-test review of the cleanup implementation after case implementation; it is not an independent human sign-off. No second reviewer is claimed.

The database connection is privileged because fixture-only paid/ledger records cannot be erased through normal financial commands. That privilege is confined by compiled SQL, the verified schema, fixed run/studio/ownership graph, all-table baseline and full-row preimages. **Every deletion has an exact primary key and an equality check against the complete reviewed JSONB row.** A missing or changed row aborts its transaction. No studio-wide delete, prefix-only delete, arbitrary table name, trigger disabling, `TRUNCATE`, reset, schema rollback or financial reconciliation is available.

Cleanup briefly acquires `SHARE ROW EXCLUSIVE ... NOWAIT` fences on the exact 76 business tables **before reading its transaction snapshot**. This prevents concurrent FK, array or JSON writers from adding a dependency between inspection and deletion. An already-active business writer causes immediate refusal. While the short transaction holds these fences, other staging writes can wait; reads continue. This staging-wide, transaction-scoped write-lock consequence must be included in later authorization. Canonical H11 deletion also uses the existing backend's dependency fencing. No production table can be targeted.

Ordered removal: undelivered outbox → unattempted lesson effects → fixture note/invoice → participants/projections/recommendations/record state → fixture ledger → lessons → bookings/series/offering → package/coverage job → guardian relationship/contact/memberships → services. Every phase commits separately with its audit marker and journal evidence, making partial cleanup resumable. Student rows are then made inactive, soft-deleted, portal-disabled and unlinked; automatic credit use becomes false. No removed financial row is presented as a production refund/reversal.

The same activity guard protects both postconditions and cleanup: outbox attempts must be zero, with no error/send/claim markers and an allowed undelivered status. Calendar projections must have zero attempts and no attempt/error/claim/external-version/projected-time markers. A requeued failed attempt is therefore protected rather than erased. Local SQL regressions inject only synthetic attempt/error markers, prove rollback/refusal, and never invoke a provider. Fixture reminders use the future lesson's start minus one day; they are not immediately due after seed.

**Retained evidence:** all audit events, idempotency/credit/occurrence receipts, all bulk jobs/items/requests, and the immutable physical-deletion snapshot. Two terminal synthetic students and their credit-account rows remain because private receipts reference them. The new coach Auth identity is **retained and banned**, with no membership, because deleting it would null the audit actor through an Auth FK. The other three newly created Auth identities are removed. This intentionally refines the proposal's original four-Auth-deletions instruction; approval must accept this retention explicitly. Original manual-test accounts and students are untouched.

The old `cleanup_lesson_bulk_fixture` bypass is deliberately absent from the executor and RPC allowlist. No `app.bulk_fixture_cleanup` setting is used by it. The original disposable concurrency suite still uses its pre-existing local-only helper; that is not the proposed hosted cleanup path.

Final proof requires every pre-existing business row unchanged; zero run-owned outbox, calendar projections, effects, coverage jobs, lessons, ledger, memberships or contacts; no processing lease or deliverable running bulk job; and an explicit retained-ID inventory. H16's unaccepted review can retain pending items, but its job remains `reviewed`, cannot be claimed, and later expires. Accepted jobs retain only terminal/blocked items. A late foreign dependency or changed preimage stops cleanup without widening deletion.

## Journal, interruption and recovery

Use a dedicated absolute directory outside the repository with Windows Owner/SYSTEM-only NTFS access and no reparse point. `mutation-config.json`, exact-host `perimeter.json`, `mutation-auth.json`, `mutation-journal.jsonl` and the authorization receipt stay private. Passwords/tokens never enter stdout, Git, CI artifacts or PR comments. All transport failures suppress sensitive diagnostics. Existing manual-test credentials are not used or reset.

The resolved physical path must also equal the supplied canonical path. A regression constructs an ancestor junction into the repository and proves refusal before file access; a local Windows read-only check confirmed that the existing private evidence directory satisfies the ACL/canonical-path check. No credential content was printed.

The journal records prepared commands, real backend idempotency keys, generated IDs, full run-owned snapshots and results before SQL commit, using fsync and a SHA-256 chain. A transactional `acceptance.commit` audit receipt binds each result digest. On a lost response, explicit `--resume` queries that receipt before deciding whether a step committed. A committed step is recovered without resending; a rolled-back step can run again using its original stable key. No transport retries or redirect following are enabled. Application replay is also tested with actual duplicate requests. A successful item is never retried as a new operation.

The process holds an exclusive local journal lock and a database session advisory lock. A hard process/OS crash can leave `mutation.lock`; **do not delete it automatically**. Inspect its host/PID/start/code metadata, prove the original process is gone, retain a private copy, and remove only that exact stale file before explicit recovery. A corrupt/truncated journal, missing committed result, unknown Auth record, exhausted budget, foreign change or unexpected schema requires investigation and a reviewed recovery decision. Do not edit journal hashes or invent replacement keys.

Interrupted Auth creation uses the fixed-ID GET and prepared journal to distinguish owned creation from collision; it never resets a password. If provisioning stopped before business seed commit, cleanup performs only owned Auth cleanup and verifies that business rows are still unchanged. A missing owned identity without a cleanup record is an error. Cleanup can recover an already-completed Auth deletion from its original preparation record. Banned retained coach state is verified on repeat.

Keep the private journal and its ACL-protected local test evidence until review/cleanup acceptance. Keep server audit/receipt/deletion evidence permanently under the current policy. After a successful hosted cleanup and accepted report, securely remove run-created password/session material from the private run directory; do not remove existing manual-test credentials. Deleting a user alone is not a claim that its JWT immediately expires: H15 explicitly proves row-based permission revocation and cleanup removes the guardian link before Auth deletion.

## Local validation and remaining limits

See the [machine-readable evidence](wave-one-hosted-mutation-executor-evidence.json) for the final measured run and command inventory. Validation uses fresh local PostgreSQL **17.10** databases cloned from the complete pinned 57-migration replay. The adapter accepts only loopback port 56435 and the pre-existing disposable recovery marker. The migrations/tests at `fe63c57e928bca78c23e43877480b36a2d8e26c6` are identical to the deployed application pin; no hosted migration is assumed or applied.

Reproduction:

```powershell
node --test scripts/staging/mutations/guards.node.mjs
$env:STAGING_PG_RUNTIME_DIR = 'C:/Users/dariu/.codex/tmp/studio-pg17-runtime'
$env:REPLAY_CRLF = 'true'
$env:VALIDATE_MUTATION_EXECUTOR = 'true'
$env:MUTATION_VALIDATE_QUICK = 'false'
node scripts/staging/test-recurring-crlf-recovery.mjs
```

The external runtime must already contain the reviewed PostgreSQL 17 Windows binaries, `pg` and pgTAP support. The command never connects to hosted services. Local scenarios cover the complete run, committed create interruption, dropped H03 response, before-commit rollback, partial cleanup, permission denial, another executor session, unexpected manual-row changes, all budgets/unknown inputs, partial provisioning, a concurrent cleanup writer and a foreign dependency. Existing pgTAP and credit/occurrence/bulk concurrency programs run against the replayed stack with actual separate-session lock checks.

Local Auth uses the replay harness's Auth schema stub. It proves application RLS and ownership logic, not hosted GoTrue behavior, NTFS protection under another Windows user, Netlify transport availability or real provider behavior. Offline tests mock only the protected transport and never treat a mock as hosted evidence. PostgreSQL 17.10 and hosted 17.11 are distinct patch versions; their reviewed application catalog seals match.

The existing application unit suite and native concurrency lane are run sequentially for final evidence. An intermediate Windows timing experiment exceeded the backend's three-second lock timeout and was discarded; application timeouts were not changed. The native transport retains the original scenario bodies/two-second holders and polls observed lock state for up to one extra second. Final results must be used rather than any interrupted/intermediate run.

Final validation comprises **14 offline guard tests**, **12 native executor scenarios**, **204 pgTAP assertions** and **three actual concurrency suites**. The unchanged application's **784 tests across 116 files** passed at the saved checkpoint; subsequent edits affect only this harness/documentation and do not invalidate that application result. Typecheck and strict changed-file lint were rerun after review. No hosted mutation success is claimed by any of these results.

## Hosted side effects and readiness gate

If later authorized, hosted effects are precisely: four confirmed synthetic Auth users and a password session for only the new guardian; three memberships, two students, guardian link/relationship, services/package/lessons/bookings/class/note/invoice fixtures; synthetic ledger and account changes; occurrence/bulk commands, frozen review jobs and per-item processing; two synthetic queued reminder intents, unattempted calendar projections and lesson/credit recovery intents; H14's owned lease aging; H15's owned permission changes; durable audit/replay/deletion evidence; then the reviewed cleanup and retention above. No effect is hidden behind a worker invocation.

Provider calls, email/OTP/invitation/reset sending, actual payment, calendar synchronization, scheduled workers, deployments, merges, production and Wave 2 remain forbidden. The network allowlist permits only protected health, exact read-only Netlify metadata, fixed-ID staging Auth administration/password authentication and the guardian financial read; SQL is the exact staging host. All other endpoints, including `/api/e2e/fixtures`, all application mutation HTTP routes and worker routes, are refused before a request.

The additional management endpoint is GET-only `https://api.supabase.com/v1/projects/lrxrivfqjpkvygozphoz/config/auth`; Auth configuration PATCH and every other project are refused. Its credential and live disabled-hook proof are still required before execution.

**Recommendation: GO for review of this executor; NO-GO for hosted execution until explicit authorization and fresh preflight.** No new hosted configuration or credential file was created. Execution still requires restricted staging-only service/anon keys, an existing direct-database password and verified TLS connectivity, read-only Netlify metadata access, a project-scoped Supabase management token with `auth_config_read`, a fresh valid exact-host perimeter session and a code-bound approval receipt expiring within 24 hours. The five exact `mutation-config.json` properties are `anonKey`, `serviceKey`, `database`, `netlifyToken`, `managementToken`. `database` permits only host/port/database/user/password/ssl with `ssl.rejectUnauthorized=true`. Do not reset the database password, create tokens or broaden credentials to satisfy this gate without authorization. Stop if the direct connection, protection, Auth hooks/configuration, environment inventory, schema, baseline or credentials fail verification.

### One exact authorization request

Authorize one execution and ordered cleanup of `e2e-wave1-hosted-20261016-a` using this reviewed executor and its evidence/code/manifest hashes, only on Supabase `lrxrivfqjpkvygozphoz`, studio `4ceff683-e72f-4b2e-96ce-85db2dca4eb2`, associated with protected unpublished Netlify deploy `6ad23d4f8b10c10447224155` on site `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`, application `0b18a5a2238daa49bec1290f5884d5792f4aefc9`: H01–H16 canonical backend cases within 4 new Auth users, 2 students, 13 seeded + at most 6 generated lessons, 3 packages, 12 granted credits, USD 100.00 synthetic paid history, 100 RPC requests, 20 items/review and 512 cumulative business rows with the documented per-table caps; fixed synthetic reminders/calendar/credit intents without delivery; service-only scoped bulk claim/process/retry and owned lease aging; guardian password-session/revocation checks; transient 76-table staging cleanup write fences; exact-row privileged cleanup; retention of audit/replay/bulk/deletion evidence, two disabled terminal students/accounts and the banned coach identity, with the other three new Auth users removed. Permit explicit journal-based recovery only within the same identity, keys and budgets, stopping on any discrepancy. No providers, real messages/payments, worker invocation, schema change, production, deployment, merge or Wave 2. This request does not authorize the outstanding browser/UI or provider-capable HTTP journeys.
