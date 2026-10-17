# Hosted executor — continuation checkpoint

October 16, 2026. The user resumed after the usage-renewal hold. Implementation and local source/adversarial review are complete and delivered in draft [PR #48](https://github.com/coach-sudo/Studio-Portal/pull/48). This file supersedes the pending-review checklist saved in local checkpoint `c8cb566`; it does not authorize hosted execution.

## Saved implementation

- Branch: `codex/wave-one-hosted-mutation-executor`, directly based on PR #47 head `3057d6cbdde6628a80d0c10b6ad9c6a323153592` / `codex/wave-one-hosted-acceptance`. PR #47 was reverified open/draft and unchanged after resume.
- [Review/report and exact authorization request](wave-one-hosted-mutation-executor.md); [sanitized evidence and complete canonical command inventory](wave-one-hosted-mutation-executor-evidence.json).
- Executor SHA-256: `5a5dbb032a9a5d62d4708e06611eb2e7a8a72b06530c6ea879659a01a44bf932`. Manifest SHA-256: `eb847cb6be0ee29dccf626427b83abdae0811efff8496438c4cb43a0e49d908a`.
- Final review added shared outbox/calendar activity guards (including attempt/error history), future synthetic reminders, atomic read-only initial baseline capture, per-preflight approval expiry, strict new Auth identity/role checks and role-specific admin methods, plus physical-path/ancestor-junction refusal for private files.
- No application, dependency, migration, deployed candidate, provider, production or Wave 2 change. No hosted mutations, new hosted Auth identities, passwords, fixtures or approval receipt. Existing manual-test accounts untouched.

## Validation

- **14/14** zero-network guard tests.
- **12/12** disposable PostgreSQL 17.10 executor scenarios, full **57-migration** replay, **204** pgTAP assertions and all **three** actual separate-session concurrency suites passed at the final executor code pin.
- Normal H01–H16: **68 RPCs**, all **16 cases**, peak **231** business rows, **253** cumulative row identities, below the **512** cap.
- **784/784 application tests, 116 files**, passed before the hold; application/dependency source is unchanged by the later harness-only review. That result is explicitly carried forward, not presented as a new run.
- Typecheck, strict changed-file lint, formatting and secret checks are documented in the final delivery. No second human reviewer/sign-off is claimed.
- Fresh read-only staging checks reconfirmed **76/76** historical business tables unchanged, and schema seal `24828e13e95714c1c42a0734fc6a6dfcb63f33a2947734cdcdbeee751efca3f4` matching native replay. Netlify remained protected for all deployments with stopped automatic builds, exact ready/unpublished preview, and unchanged legacy publication.

Private local evidence: `C:/Users/dariu/.codex/private/studio-portal-staging/hosted-acceptance-20261016/`, particularly `executor-reviewed-final-local.log`, `executor-unit-final-results.json`, and `executor-resume-typecheck.log`. Full private journals are in the latest `mutation-validation-*` directory under `C:/Users/dariu/.codex/tmp/studio-pg17-runtime/`. Never print/upload private journals, sessions, credentials or full environment responses. Local clusters stopped after tests; no hosted worker was invoked.

## Next gate

Review draft PR #48; it is already created and attached to this chat. Its base is `codex/wave-one-hosted-acceptance`; implementation commit is `110bb74d58dd99929f85f291e05313f1562ad303` (later delivery metadata edits are documentation only). Do not create a duplicate, merge or deploy. The existing CI branch filter excludes this dependent base; no missing GitHub check is claimed as passing. All commits use `[skip netlify]`; stopped builds and protection remain intact.

The one concrete hosted execution/cleanup authorization request is in the report. No hosted mutation is authorized yet. Execution additionally requires fresh credential/perimeter/schema/baseline/permission preflight, direct staging SQL connectivity and an existing project-scoped `auth_config_read` credential proving disabled Auth hooks, no SMTP/external provider and unchanged exact Auth URLs. Do not create/reset credentials or alter infrastructure to bypass a failed gate.

Explicit approval must include cleanup's short 76-table staging write fence; retained immutable audit/replay/bulk/deletion evidence; two disabled terminal students/accounts and a banned coach Auth identity; removal of only the other three new identities. H06 proves canonical SQL, not provider-capable HTTP rescheduling; H16 proves bounded reads/frozen review/progress, not browser result routing. Native Auth is a schema stub, not hosted GoTrue.

Production remains **NO-GO**. No deployment, merge, providers, real messages/payments, hosted fixtures, scheduled workers or Wave 2 without their required explicit authorization.
