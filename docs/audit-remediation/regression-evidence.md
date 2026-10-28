# Regression evidence

## Worker truth and observations — draft #69

Implementation checkpoint `bb6aa54f91b9d9002bb59d9a62d58cc2650514c3`.

| Gate                                                                                                   | Actual result                                                                                  | Boundary                                                                               |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Six-file targeted Vitest run, New York, `--maxWorkers=1`                                               | 28/28 passed                                                                                   | Unit/component/PGlite; no external provider                                            |
| `tsc -b --pretty false`                                                                                | Passed                                                                                         | Windows Node 24.14.1                                                                   |
| Full-schema upgrade and clean replay                                                                   | Passed in [migration CI](https://github.com/coach-sudo/Studio-Portal/actions/runs/40631951700) | Isolated PostgreSQL 17, synthetic history                                              |
| SQL lint, generated-type parity, pgTAP                                                                 | Passed in same CI                                                                              | Full schema, includes added service-only/fencing/history assertions                    |
| Credit, occurrence, bulk, material, provider and scheduled-worker separate-session concurrency scripts | Passed in same CI                                                                              | Real PostgreSQL concurrency; no provider delivery                                      |
| Initial verify CI                                                                                      | Failed: two new `no-unused-vars` signature warnings                                            | Fixed without raising warning budgets; local baseline again 904 warnings / zero errors |
| Worker tests after lint correction                                                                     | 14/14 passed                                                                                   | Safe no-op observer inference only; no command semantics change                        |
| Full regression/build/browser checks at corrected head                                                 | Pending                                                                                        | Never implied passed from another checkpoint                                           |

No provider worker has been enabled or invoked. The old Gmail-stage incident remains known only by safe category and stage. Three real scheduler-origin completions and role/device/recovery/provider acceptance remain release gates.

## Independent public contrast — draft #70

Implementation checkpoint `fb9c511`. `node node_modules/@playwright/test/cli.js test --config e2e/audit-contrast-local/playwright.config.ts`: 8/8 Windows browser combinations passed, Chromium/WebKit × 320/390/768/1440. Seven UI states per combination, keyboard actions, axe A/AA and no-overflow checks. Minimum measured summary contrast 12.19:1. Typecheck and branding unit check passed. Screenshots and computed pairs are in that PR's `docs/audit-contrast/evidence`; local HTTP responses are synthetic and do not prove canonical or provider outcomes.

The five original audit reproductions were recovered from the original task and rerun transiently against unchanged booking code: 5/5 demonstrated the original defects. Their shell-wrapped transcript is preserved in this branch. Remediation must invert those assertions, with additional real-database transaction faults and concurrency checks, before those findings are resolved.

## Environment failures retained

The unfiltered Windows baseline picked up ignored `.tmp` Playwright diagnostic specs and ran out of memory. A broad two-worker run exhausted native/WASM code memory. Focused single-worker runs succeeded. WSL/Docker was detected, but attempted isolated setup later failed with WSL E_UNEXPECTED / ERROR_NETNAME_DELETED; no existing database was reset. Full database checks above came from actual isolated CI execution. These environment failures are not converted into product passes.
