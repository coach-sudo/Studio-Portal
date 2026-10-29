# Release A: readable public booking and compatible tooling

This candidate integrates existing drafts #70, #72 and #76 on audited/current main `fb2fcb63f7ac6f06dc8ee9d954e519bdde5773cb`. Their original commits and evidence remain in the merge ancestry. The application/test/toolchain assembly is `3ade455881df01441bbe506f79642fc57e4d9ffa`; subsequent track-A changes only record evidence. The coordinator will reuse PR #70 rather than open another draft.

Customers will see legible booking summaries and footer text with the studio's purple branding, readable action buttons, visible keyboard focus, and headings that wrap on narrow screens. The booking steps, price calculations, payment behavior, identity, permissions and provider operations are unchanged. Vite 8.1.6 / Vitest 4.1.12 patch the existing tooling lines, and the booking test fixtures behave consistently across five host timezones. This is a focused accessibility release, not a redesign.

## Scope and dependencies

| Existing draft | Preserved head                             | Included behavior                                                                                                                             |
| -------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| #70            | `ce11181bfa1e75e5beb090ddcc79474136664534` | Semantic foreground/background pairs; remove competing summary CSS ownership; bounded heading scale; public focus and touch-target treatment. |
| #72            | `49d1c755edec84b3eec3c69ce03c8413b6df558d` | Explicit booking test timezone fixtures and five-zone regression command; exclude transient diagnostics from test discovery.                  |
| #76            | `da2605b9efcdf33b16bc3631013aec76105db75b` | Compatible patched tooling/lock graph and original Windows verification evidence.                                                             |

All three parents are main-based and merged without conflicts. There are **zero new migrations** and no changes under `netlify/functions`, booking command contracts, database authorization, accounting or provider processing. Existing no-deploy controls, production checks, isolated PostgreSQL checks, browser journeys and exact staging-artifact packaging are retained. The unrelated broader Dependabot draft must reconcile its overlapping manifest edits rather than overwrite this lock graph. None of these improvements depends on Releases B or C.

Rollback is a normal reviewed revert of the integrated source/manifests. It requires no data repair or schema rollback. Reverting #70 restores the known public contrast defect, so retain its fix if only the tooling change needs reversal.

## Validation on the assembled source

- Branding unit test: **1 passed**.
- Original booking tests: **7 passed in each of five explicit host timezones** (35 executions): New York, UTC, Los Angeles, Tokyo and Honolulu.
- Fresh Windows Chromium/WebKit matrix: **8 passed**, zero retries, four widths (320/390/768/1440), seven states each: service catalog, setup, time selection without a slot, customer details, disabled payment confirmation, recoverable error and confirmation.
- Computed summary text contrast: **12.193:1 minimum** with the production-equivalent primary `#37129b` and white foreground. Each route/state also passed automated WCAG A/AA checks, no horizontal-overflow assertions, keyboard activation/focus assertions, native required-field validation and preserved form input after the injected failure.
- Full npm audit: **zero advisories** in this candidate's lock graph. Installed tooling versions match its manifest (Vite 8.1.6, Vitest 4.1.12, TypeScript 6.0.3).
- Forced TypeScript/build/bundle verification uses private worktree caches, with dependencies accessed through package-level junctions. The first build used a shared root junction; because incremental caches could be shared, it is superseded by the forced isolated verification. No installation or dependency mutation was performed through either junction.

The browser harness blocks external requests and uses synthetic HTTP fixtures. Its expected blocked-preload warnings do not establish an external provider failure. These checks establish presentation and interaction behavior, not real payment, Calendar, email, authenticated hosted-role or full portal acceptance. No full infrastructure matrix was repeated during iteration; the coordinator owns the mandatory final exact-candidate CI milestone.

See [machine-readable verification](evidence/verification.json), [browser log](evidence/browser.log), [timezone matrix](evidence/timezone-matrix.log), [audit](evidence/npm-audit.json) and [isolated build](evidence/build-isolated.log). Original before screenshots are the audit's unmodified production images at 1363×936 in `../../audit-contrast/evidence/production-before-1.jpg` and `production-before-2.jpg`. Fresh after images in [evidence/screenshots](evidence/screenshots/) are synthetic local views at the requested widths. They are not represented as deployed production images or a pixel-matched comparison.

## Specific release gates

| Class                             | Issue                                                                                                                                                        | Why it applies                                                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — direct blocker                | Final exact-candidate protected CI/packaging must pass.                                                                                                      | Independently green parents do not prove the assembled source. Coordinator owns this one milestone.                                                                                                                       |
| B — shared-system blocker         | Any failure in mandatory repository-wide checks remains blocking.                                                                                            | This candidate preserves the existing full gates and does not exempt itself. No additional unresolved source dependency was found in this assembly.                                                                       |
| C — independent outstanding issue | Stripe sandbox credential and unverified installment settlement; Google intake/reconciliation; historical scheduling/corrections; identity-group acceptance. | A changes no handler, migration, financial command, source review or provider call used by those new behaviors. Their unfinished drafts are absent from A. Their failures must not be relabeled fixed by this release.    |
| C — residual acceptance limit     | Manual screen-reader/touch sessions and configured appearance combinations beyond the production-equivalent palette are not claimed complete.                | Automated keyboard/axe/geometry/contrast coverage passed; the full portal remains uncertified.                                                                                                                            |
| D — operational approval          | Owner authorization for merge/publication and any hosted staging preview.                                                                                    | No deployment, hosted migration, worker enablement, real booking/payment/message or Auth change is authorized by assembling the candidate. A itself requires no provider credential, provider mutation or schema rollout. |

Recommendation: release this small candidate first once its mandatory exact-source gates pass and the owner authorizes publication. Keep production intake disabled and all financial/provider changes on their own higher-risk release track.

## Next experience work, after this candidate

Source inspection found six primary coach destinations and eight studio destinations. The existing mobile More sheet and workspace search already provide the latter destinations; adding duplicate dashboard controls would increase clutter. A useful next bounded journey is to check mobile navigation and return-to-record context across Calendar → student → lesson with the upcoming B/C integration source. This is an investigation recommendation, not a reproduced defect or a reason to expand Release A. No additional interface widget or redesign was added.
