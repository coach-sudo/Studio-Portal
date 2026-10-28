# October 2026 system remediation

Baseline: `fb2fcb63f7ac6f06dc8ee9d954e519bdde5773cb`. Read the attached October 27 REPORT.html completely before implementation. The original audit task is `01a1806a-8d88-7746-b157-7eba00def0ca` (durable host); its Library package is `libfile_269adb0308a481919b4f2133dd94201f`. The package cannot currently be downloaded through the connected local tools. The original five-case harness was recovered from the task's command transcript; the `.txt` copy preserves its shell quoting. The runnable reproduction normalizes that wrapping only. Embedded production screenshots are extracted from the supplied HTML without editing.

## Current state (October 28)

- Initial checkout: clean `codex/weekly-audit-remediation-2026-10-26`, `9dac430ce3d8da8182ff95fc85d6e3616acfcaa0`.
- Fresh origin/main: exact audited baseline. Local main was stale. No fixes landed after the audit.
- Production: locked ready deploy `6ae0227d28d529e36c4a41e6`, same full baseline SHA, published October 27 04:05:59.566 UTC; Node 22 functions.
- Production migration list: 71 versions matching repository through `20261026161014`. Observed read-only; no schema or data mutation.
- Production intake: Functions-scope `WORKER_PROVIDER_INTAKE_ENABLED=false`; latest receipt failed at October 27 04:00:52.382725 UTC, category provider. Maintenance completed October 28 04:05:21.417325 UTC. Historical Gmail failure cause remains unproven beyond its stage/category.
- Open PRs reviewed: existing Wave 1/2 acceptance and compatibility branches overlap released/squashed work; do not replay them wholesale. Dependency PR #59 covers a broad development-toolchain update; #68 covers production packages. New security patch work must identify its narrower scope and relationship.
- Architecture reviewed: release-safety, occurrence-safe lesson changes, worker containment, current command/worker SQL and regression fixtures. Existing signed immutable-deploy dispatch, 20-minute lease, claim fencing, service-only grants and production stop remain authoritative.

## Change plan and release boundaries

| Change                       | Findings / workflows / connections                     | Dependencies                    | Recovery and release gates                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker truth and diagnostics | SP-01/14; C01–C04/C06, F03–F05; X03/04/16/18/19/20     | Existing worker receipts        | Additive private observations; revert application independently, retain observations. Full local PostgreSQL/CI and controlled provider runs required. Keep intake disabled. |
| Booking semantic colors      | SP-15; B01, F04/F06; X13                               | Independent                     | Revert CSS/token change. Computed colors, keyboard and 320/390/768/1440 Chromium/WebKit evidence required.                                                                  |
| Manual command transaction   | SP-05/06/07/08/09; B03/D01/D06/E05; X01/02/05/09/13/14 | Financial/occurrence invariants | Additive migration, synthetic transaction faults and real PostgreSQL races. No financial policy changes or overlap-constraint removal.                                      |
| Coach historical time        | SP-02/03/04; B03/04/05/06/08; X06/13                   | Manual command                  | Explicit timezone/DST and attendance/financial/notice choices; unchanged public/student policy.                                                                             |
| Provider review/discovery    | SP-10/11/12/13; B04/B10/C01–C07; X03/04/05/08/12/18    | Review receipts                 | Preview-first reconciliation; no mass reopening/imports. Controlled source/identity tests and explicit outcome confirmation.                                                |
| Finance/security/performance | SP-16/17/18/19; D01–D06/F03/F06/F07; X09/10/14/16/20   | Focused investigation           | Fault-injected ledger/outbox checks; approval for production Auth; measured history paging without truncating totals.                                                       |

No merge, deployment, hosted migration, live provider import, financial adjustment, real email, charge or refund is authorized. This work stops at draft PRs. Staging publication also needs separate approval. Local/synthetic proof is explicitly separate from authenticated hosted acceptance and external delivery.

## Evidence discipline

Current draft index: [#69](https://github.com/coach-sudo/Studio-Portal/pull/69) worker truth and the central deliverables; [#70](https://github.com/coach-sudo/Studio-Portal/pull/70) semantic booking contrast; [#71](https://github.com/coach-sudo/Studio-Portal/pull/71) atomic manual booking; [#72](https://github.com/coach-sudo/Studio-Portal/pull/72) portable original tests; [#73](https://github.com/coach-sudo/Studio-Portal/pull/73) historical creation/timezones, stacked on #71; [#74](https://github.com/coach-sudo/Studio-Portal/pull/74) source/attendance separation; [#75](https://github.com/coach-sudo/Studio-Portal/pull/75) installment settlement/recovery; [#76](https://github.com/coach-sudo/Studio-Portal/pull/76) narrow toolchain security patches. Every created PR is attached to the mission. No PR has been merged or published.

The [register](remediation-register.md), [exact matrix](acceptance-matrix.md), [architecture report](architecture-and-quality.md), [regression evidence](regression-evidence.md), [release readiness](release-readiness.md) and [decision proposals](decisions.md) distinguish implemented layers from unverified downstream behavior. Original five reproductions and before screenshots remain in this evidence package; relevant after screenshots and measurements live in their focused drafts.

Each finding retains its cause, code, exact affected register entries, proposed fix, actual tests, residual acceptance gates, review status and commit/PR references. The workflow and connection matrix retains all 42 and 20 entries from the audit. No end-to-end PASS is inferred from a mock, unit/component test or saved database status.

Environment evidence: the first unfiltered `npm test` discovered ignored `.tmp/*.spec.ts` diagnostic files and did not reproduce the clean audit invocation. Preserve that log; use tracked suite paths for the baseline and repair discovery in the test-portability PR. Node here is 24.14.1; CI/deploy use Node 22. Full-schema migration and concurrent-session gates must run in isolated PostgreSQL, separately from PGlite fixtures.
