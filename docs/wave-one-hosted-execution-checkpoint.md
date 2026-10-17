# Authorized H01–H16 execution — blocked before hosted writes

October 16, 2026 (Eastern). **PARTIAL / BLOCKED — credential preflight failed before H01.** The user explicitly authorized one H01–H16 execution and reviewed cleanup; no additional execution proposal or approval is being requested. This report preserves the result of attempting to prepare that authorized run.

## October 17 authorized password reset and stopped verification

**Latest status: staging database password reset succeeded; H01–H16 remain PARTIAL / BLOCKED before execution.** The user's subsequent explicit instruction, “reset,” authorized this narrowly scoped staging PostgreSQL password change and superseded the earlier no-reset boundary for this operation only.

Before the operation, the unchanged execution receipt was still valid, and the exact staging project returned the expected identity and `ACTIVE_HEALTHY` state. The existing CLI management credential was used for one supported [database-password update](https://supabase.com/docs/reference/api/v1-update-database-password): `PATCH /v1/projects/lrxrivfqjpkvygozphoz/database/password`, with **only `password`** in the body. A cryptographically random password was saved durably to the restricted local store before the single request. Supabase returned **HTTP 200** at approximately `2026-10-17T05:13:33Z` (October 17, 1:13 a.m. Eastern). No automatic reset retry occurred. The existing token's permission was sufficient; no management token was created or broadened.

Only the staging database credential changed. No production operation, schema/migration change, Auth-user password reset, API-key rotation, Auth URL/provider change, deployment, publication, worker or provider invocation was performed. External direct clients using the previous staging database password will need the new credential; no such clients were reconfigured automatically.

The new credential is in `C:/Users/dariu/.codex/private/studio-portal-staging/hosted-mutations-20261016-a/database-credential.json`, protected by the reviewed Owner/SYSTEM-only ACL and canonical-path checks. Private reset intent/result and sanitized verification evidence are beside it. No password, token, session or raw API response was printed or committed. The original authorization receipt was not edited or replaced.

Two validation blockers prevent execution:

1. **Direct SQL verified-TLS connection fails with `SELF_SIGNED_CERT_IN_CHAIN`.** The exact `db.lrxrivfqjpkvygozphoz.supabase.co:5432` endpoint was used with `ssl.rejectUnauthorized=true`. The TLS handshake failed before SQL/authentication, so the new password's database-login success, current schema seal and baseline are **not verified**. No certificate-validation bypass, alternate host/pooler, changed executor or database query fallback was attempted. A verified trust chain for the staging database must be established on the approved runner before this gate can pass.
2. **Netlify's returned service credential was redacted and failed the reviewed JWT validation.** The anon credential's staging claims passed; the service credential did not. The incomplete configuration was withheld as private `mutation-config.unvalidated.json`, leaving **no runnable `mutation-config.json`**. A valid existing staging service key must be obtained through an authorized supported secret-read path, without creating/rotating a key or broadening its scopes. No attempt was made to use the redacted value for hosted Auth or business operations.

The reviewed executor code hash still matches `5a5dbb032a9a5d62d4708e06611eb2e7a8a72b06530c6ea879659a01a44bf932`; PR #48 remains at the approved commit. Existing exact-host perimeter cookie metadata passed its local expiry check, but fresh protected health and the remaining Netlify/database preflight gates were **not completed**. This is not a hosted acceptance PASS.

**H01–H16: 0/16 executed. Hosted business rows created/removed: 0/0. No execution journal or business cleanup started.** The authorized staging password reset is the only hosted mutation in this attempt. Production remains **NO-GO**. Resume only the same approved run after the blockers are resolved and all fresh gates pass; if the unchanged receipt has then expired, stop for fresh authorization.

## Earlier October 17 credential resolution checkpoint

**Status at that earlier checkpoint: PARTIAL / BLOCKED on the unavailable existing direct staging PostgreSQL password.** This missing-password status is superseded by the authorized reset above. The management credential prerequisite was resolved for the exact staging Auth configuration read; no execution had started. The initial-attempt details below remain historical unless explicitly updated here.

The existing authorization receipt was checked before any credential investigation. It was valid at `2026-10-17T05:06:20Z`; its unchanged expiration is `2026-10-18T01:51:11.595Z` (**October 17, 9:51 p.m. Eastern**). No timestamp was extended or receipt replaced. PR #48 remains open/draft at approved executor commit `9b10d19c1fb48e637d1712e06694443725b017cd`; PR #49 still depends directly on its branch. No executor source changed.

The existing `Supabase CLI:supabase` Windows Credential Manager entry was read in memory through the native credential API, without displaying or persisting its secret. An authenticated **GET only** to `https://api.supabase.com/v1/projects/lrxrivfqjpkvygozphoz/config/auth` returned **HTTP 200** at `2026-10-17T05:07:33Z`. This proves the existing credential can read this project's Auth configuration; CLI login alone was not treated as proof, and no claims are made about other token scopes. No other project's configuration was requested.

The response confirmed the exact approved Site URL and both callback entries, required hooks explicitly disabled, no enabled additional hooks, no SMTP host, and no enabled external provider other than the existing email authentication setting. Only sanitized booleans/status were recorded. Auth configuration was not modified. The secret and raw response were not placed in logs, source control, chat or a new credential file.

The original PostgreSQL password was not found in the reviewed restricted staging files, staging runtime/deployment preparation directories, staging-linked project metadata, process/user/machine environment, standard PostgreSQL password files, CLI fallback files or staging-specific native credential inventory. The native Supabase entry is a management credential, not a database password. No browser-session extraction, unrelated-account access, guessed password, direct database connection or connection fallback was attempted.

The approved private directory and sanitized evidence file passed the executor's Owner/SYSTEM ACL and canonical-path checks. Evidence is retained locally in `credential-preflight-20261017.json` beside the original receipt. No `mutation-config.json` or execution journal exists; an incomplete credential configuration was not invented. **H01–H16 remain NOT EXECUTED, hosted writes remain zero, and cleanup remains unnecessary/not started for these attempts.** Fresh database, 76-table baseline, Netlify/perimeter and other execution gates remain unrun, not passed.

The supported user-controlled handoff is to locate the **original staging project's database password** in the password manager or secure record used at project creation and supply it only through the restricted local handoff directory below. Supabase documents that the original password [cannot be retrieved through the Management API](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration). If no original copy exists, the documented alternative is a [database password reset](https://supabase.com/docs/guides/database/postgres/roles#changing-your-project-password), which requires separate authorization and was not performed. Do not paste any password into chat. No new management token is needed for the verified read capability.

Resume only the same approved run after the missing credential is securely available, rechecking the unchanged receipt's actual validity and every fresh safety gate. If the receipt has expired at that point, stop for fresh authorization. Production remains **NO-GO**.

The approved executor remains draft [PR #48](https://github.com/coach-sudo/Studio-Portal/pull/48), commit **`9b10d19c1fb48e637d1712e06694443725b017cd`**. This documentation checkpoint does not modify its runtime source, manifest, command inventory or reviewed branch head.

## Exact scope and verified source

| Item                 | Authorized identity                                            |
| -------------------- | -------------------------------------------------------------- |
| Run                  | `e2e-wave1-hosted-20261016-a`                                  |
| Application          | `0b18a5a2238daa49bec1290f5884d5792f4aefc9`                     |
| Supabase             | `lrxrivfqjpkvygozphoz`                                         |
| Studio               | `4ceff683-e72f-4b2e-96ce-85db2dca4eb2`                         |
| Netlify              | `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`                         |
| Protected deployment | `6ad23d4f8b10c10447224155`                                     |
| Origin               | `https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app` |

GitHub independently confirmed PR #48 open/draft, its exact approved head, and base `codex/wave-one-hosted-acceptance`. The checkout was clean at that commit. Recomputed hashes match its evidence:

- Executor: `5a5dbb032a9a5d62d4708e06611eb2e7a8a72b06530c6ea879659a01a44bf932`.
- Manifest: `eb847cb6be0ee29dccf626427b83abdae0811efff8496438c4cb43a0e49d908a`.

Source/review requirements are unchanged: [executor report](wave-one-hosted-mutation-executor.md), [local evidence/command inventory](wave-one-hosted-mutation-executor-evidence.json), [proposal](wave-one-hosted-mutation-proposal.md), [hosted acceptance](wave-one-hosted-acceptance.md), [historical 76-table baseline](wave-one-hosted-business-verification.json), and [Auth checkpoint](wave-one-staging-auth-configuration.md). Earlier “not authorized” statements in those historical reports are superseded only by the user's new explicit authorization, not by a claimed execution success.

## Exact blocking prerequisite

**The reviewed executor has no available existing direct staging PostgreSQL password/database configuration.** Its mandatory connection is `db.lrxrivfqjpkvygozphoz.supabase.co:5432`, database/user `postgres`, verified TLS with `ssl.rejectUnauthorized=true`. No connection attempt or password guess was made.

The reviewed restricted staging locations and runner environment were inspected without printing secret values. Existing protected files supply browser URL/anon configuration and original synthetic account credentials, but not the required PostgreSQL password. The original synthetic users' passwords are application-login credentials; they are not a database credential and were not substituted. No ready `mutation-config.json` was found.

An existing management configuration-read credential is also **not supplied to the executor**, so its required live Auth configuration/hook inspection has not been verified. This is not a claim that the user's account globally lacks `auth_config_read`: that capability was not tested because no suitable runner credential was available. Existing connector/CLI access does not prove the required direct SQL/TLS connection or satisfy the executor's credential input.

The user's instruction was to stop if a mandatory prerequisite fails. Accordingly, no alternative SQL script, MCP mutation, connection fallback, password reset, credential creation/broadening, altered guard, provider call or executor replacement was attempted.

## Initial attempt gate results

| Gate                                                           | Result in this attempt                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| Approved Git commit, PR dependency, source/hash/manifest       | PASS                                                            |
| Restricted local directory, canonical path, Owner/SYSTEM ACL   | PASS                                                            |
| Prior hosted journal in reviewed staging locations             | None found; disposable native-test journals are not hosted runs |
| Direct staging PostgreSQL credential/verified TLS              | BLOCKED: credential unavailable; not connected                  |
| Management configuration-read credential/live Auth hooks       | BLOCKED / unverified                                            |
| Live project/studio, exact migrations/schema/privileges        | NOT RUN after credential failure                                |
| Fresh consistent 76-table/row baseline and unused-UUID proof   | NOT RUN after credential failure                                |
| Fresh Netlify deploy/protection/build/hooks/env/release health | NOT RUN after credential failure                                |
| Live existing-account/membership verification                  | NOT RUN after credential failure                                |
| Hosted H01–H16 and cleanup                                     | NOT STARTED                                                     |

Prior read-only checks and local tests in PR #48 remain historical evidence. They are not relabeled as fresh preflight or hosted mutation passes for this attempt. No baseline was overwritten or adopted.

## Private authorization and evidence

Created the requested local authorization receipt in the reviewed format, bound to the approved source, manifest, exact targets, budgets, cleanup fences and retained-record policy. It expires 23 hours after creation, within the permitted 24-hour ceiling, and passed the reviewed validator. No broader authorization was invented.

Private directory: `C:/Users/dariu/.codex/private/studio-portal-staging/hosted-mutations-20261016-a/`.

- `authorization.json`: explicit authorization record; no credential secrets.
- `preflight-blocked.json`: gate statuses and zero-execution evidence.
- **No `mutation-journal.jsonl`, `mutation-config.json` or new `mutation-auth.json` was created.** The execution receipt has not been consumed by a run.

These files remain outside Git under the reviewed ACL/path controls. Original manual-test credentials were neither changed nor copied into shared artifacts. Do not print their contents or paste secrets into chat/PRs.

## H01–H16 outcomes

| Case                                 | Outcome      |
| ------------------------------------ | ------------ |
| H01 — grant/replay                   | NOT EXECUTED |
| H02 — automatic coverage/create      | NOT EXECUTED |
| H03 — repeated application           | NOT EXECUTED |
| H04 — completion replay              | NOT EXECUTED |
| H05 — return/replacement reservation | NOT EXECUTED |
| H06 — reviewed rescheduling          | NOT EXECUTED |
| H07 — recurring conversion           | NOT EXECUTED |
| H08 — shared occurrence cancellation | NOT EXECUTED |
| H09 — prepaid/class protection       | NOT EXECUTED |
| H10 — dependency preview             | NOT EXECUTED |
| H11 — physical deletion/replay       | NOT EXECUTED |
| H12 — archive/restore/void           | NOT EXECUTED |
| H13 — stale mixed batch              | NOT EXECUTED |
| H14 — lease/retry processing         | NOT EXECUTED |
| H15 — guardian old-JWT revocation    | NOT EXECUTED |
| H16 — frozen selection/results       | NOT EXECUTED |

Canonical RPCs **0/100**; Auth identities **0/4**; students **0/2**; seeded/generated lessons **0/13 + 0/6**; package lots **0/3**; credits granted **0/12**; synthetic paid history **USD 0/100**; maximum created business rows **0**, cumulative **0/512**. No bulk review, claim or retry was issued. All subsidiary mutation budgets remain unused.

## Financial, cleanup and security result

No financial command, reconciliation, lesson change, permission change, provider request, worker invocation, delivery, deployment, merge or production operation occurred. No original manual account/household relationship was modified by this attempt.

Rows created/removed by this attempt: **0/0**. No new business audit/replay/deletion records, terminal students, banned coach identity or deliverable intent were created by it. Cleanup was **not required for this attempt and was not started**; no staging write fence was acquired. No current server-side UUID/receipt-absence or original-row comparison is claimed, because the corresponding live gates were not reached. This is not a cleanup PASS or a claim that full-table hashes remain identical after an executed run.

## Required handoff and safe continuation

The authorized reset now supplies the staging PostgreSQL password privately; the original-password handoff is no longer needed. Resolve the verified-TLS trust-chain and valid existing service-key prerequisites described in the latest checkpoint before assembling a runnable configuration. The existing management credential's exact configuration-read capability is verified and can be reused without creating or broadening a token. The reviewed `mutation-config.json` format still requires `anonKey`, `serviceKey`, `database`, `netlifyToken`, `managementToken`; the database object requires only host/port/database/user/password/ssl and the approved verified-TLS settings. Do not repeat the reset, create new tokens, broaden credentials, weaken TLS or change the executor automatically.

Once the credential prerequisite is satisfied, resume the **same authorized run** from reviewed executor commit `9b10d19c1fb48e637d1712e06694443725b017cd`, recheck receipt validity and all fresh live gates, and check again for any started journal/server receipts before execution. Do not overwrite this receipt or invent a second run/key sequence. A receipt that has expired must not have its timestamps edited to bypass the validity gate.

Remaining acceptance is unchanged: the two local application fixes in PR #47 await separately authorized redeployment; hosted browser mutation journeys, alternate query-mode coverage, isolated providers/scheduled cadence and human usability review remain pending. H06's canonical SQL and H16's backend continuity never substitute for those journeys.

**Final classification: PARTIAL / BLOCKED before execution. Production remains NO-GO.** No new deployment, publication, merge, providers, scheduled workers or Wave 2 is authorized by this checkpoint.
