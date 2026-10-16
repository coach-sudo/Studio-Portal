# Resume checkpoint — user-requested hold

October 16, 2026. The user requested a safe stopping point for usage renewal. Stop work here until resumed. No automation was created.

## Saved state

- Local branch: `codex/wave-one-hosted-mutation-executor`, directly based on draft PR #47 head `3057d6cbdde6628a80d0c10b6ad9c6a323153592` (`codex/wave-one-hosted-acceptance`). No remote push/new PR yet.
- [Implementation/review report](wave-one-hosted-mutation-executor.md), [sanitized evidence and full command inventory](wave-one-hosted-mutation-executor-evidence.json).
- Executor code SHA-256: `2e2009f3d754fb0440b04ca99f0bb47745575f757b02a3b3aa3c070bcad3e672`. Manifest SHA-256: `eb847cb6be0ee29dccf626427b83abdae0811efff8496438c4cb43a0e49d908a`.
- No application, migration, provider, deployment, production or Wave 2 change. No hosted mutations, Auth users, passwords, fixtures or approval receipt created. Existing manual-test accounts untouched.

## Verified evidence

- Final full application run: **784/784 tests, 116 files**.
- Offline safety guards: **11/11** (`node --test scripts/staging/mutations/guards.node.mjs`). This file is intentionally named `.node.mjs` to keep Vitest from loading Node's separate test runner.
- Disposable PostgreSQL **17.10**, full **57-migration** replay: **11 executor scenarios**, **204 pgTAP assertions**, all **three original concurrency suites**, actual observed separate-session lock contention. Latest full run exited zero after the final Auth preflight guard was added.
- Normal H01–H16 run: **68 RPCs**, all **16 cases**, peak **231** business rows, **253** cumulative row identities, below the **512** ceiling.
- Typecheck, changed-file ESLint with zero warnings, full format check and secret scan passed. No dependency/lockfile or application source change.
- Read-only staging: PostgreSQL **17.11**, **57** migrations; exact schema seal matches native replay (`24828e13e95714c1c42a0734fc6a6dfcb63f33a2947734cdcdbeee751efca3f4`); all **76** historical business fingerprints unchanged.
- Netlify exact preview remains ready/unpublished; team login applies to all deployments; CLI `getSite` confirmed stopped automatic builds and unchanged legacy published deployment `6ace53e7f850061d7c49b711`.

Private local evidence is under `C:/Users/dariu/.codex/private/studio-portal-staging/hosted-acceptance-20261016/`. Use `executor-pinned-local.log`, `executor-unit-final-results.json`, `executor-typecheck.log`, `executor-format.log`. Full private executor journals are in the latest `mutation-validation-*` directory under `C:/Users/dariu/.codex/tmp/studio-pg17-runtime/`. Never print or upload private journals, account/session files, full environment responses or credentials. Native clusters stopped after testing; no hosted worker was invoked.

## Remaining work on resume

1. Reverify Git/PR #47 head and the local code/evidence pin before editing. Finish adversarial review of the privileged fixture/cleanup and hosted adapter; a second human reviewer has not signed off. In particular, review attempted-delivery detection (outbox attempt/error fields as well as status/sent/claim), and all Auth/config failure paths before calling this final delivery ready. Any repair needs appropriate focused/local validation and new code/evidence hashes.
2. Review documentation for precise coverage and limits: H06 canonical SQL excludes the provider-capable HTTP wrapper; H16 tests bounded reads/frozen scope/progress, not browser result-route behavior. Native Auth is a schema stub, not hosted GoTrue.
3. Fresh hosted execution preflight is still missing direct SQL credential/connectivity and a project-scoped `auth_config_read` management token/live hook checks. Do not create/reset credentials or alter Auth configuration. The adapter fails closed unless creation/password/access-token hooks are proven disabled, SMTP/external providers absent, exact Auth URLs preserved, private ACLs and perimeter valid, and all existing target/baseline/schema/provider guards pass.
4. Once final review/checks are complete, commit any follow-up and create a **draft PR directly based on `codex/wave-one-hosted-acceptance`**, attach it to this chat. Preserve stopped Netlify builds; use `[skip netlify]` commits; do not push/merge main or deploy. The current CI branch filter does not automatically cover this dependent base; report actual checks honestly.
5. Present the one exact hosted execution/cleanup authorization request already prepared in the report. Explicitly include the temporary 76-table staging cleanup write fence, retained audit/replay/bulk/deletion evidence, two terminal students/accounts and banned coach identity; delete only the other three newly created identities. No hosted mutation is authorized yet.

Intermediate test failures were resolved or explicitly discarded: the Node guard file originally entered Vitest discovery; one booking-loading assertion failed while heavy suites competed but all 784 passed sequentially; a five-second local lock-holder experiment exceeded backend lock timeout and was reverted. Original concurrency SQL/assertions/two-second holders remain unchanged; the native adapter now polls lock state for up to one additional second. Use final pinned results, not intermediate logs.

Production remains **NO-GO**. No deployment, merge, providers, real notifications/payments, hosted fixtures, scheduled workers or Wave 2 on resume without the necessary explicit authorization.
