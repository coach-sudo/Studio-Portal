# PR7 performance and stylesheet review

## Measurement method

- `npm run build && npm run bundle:analyze && npm run bundle:check` records every built asset's raw/gzip size in `dist/bundle-analysis.json` and enforces the unchanged warning/failure budgets.
- `e2e/pr7-performance.spec.ts` opens a new browser context for each representative route with service workers and Chromium cache disabled, waits for its first heading and fonts, then samples after 500 ms. It records browser request counts and Performance Resource Timing `transferSize` for same-origin resources. Cross-origin providers may omit transferred bytes without a Timing-Allow-Origin header, so the byte comparison is a same-origin lower bound, not a total network bill.
- Desktop and mobile samples use the same deterministic `e2e-` fixture family and routes before and after optimization. GitHub's free ephemeral Supabase/Netlify Dev runner is used; production is never a test target.

## Baseline — accepted PR6 head `c5a49ce`

| Built asset         | Raw bytes | Gzip bytes |
| ------------------- | --------: | ---------: |
| Entry JavaScript    |   425,393 |    125,061 |
| Global CSS          |   140,114 |     24,884 |
| StudentWorkspace JS |    79,966 |     18,910 |
| StudentPortal JS    |    73,832 |     18,588 |
| StudioOperations JS |    64,397 |     16,489 |
| BookingCenter JS    |    49,697 |     12,721 |
| CoachSection JS     |    42,560 |     11,765 |
| PublicBooking JS    |    39,134 |     11,303 |
| DOMPurify JS        |    26,818 |     10,610 |

Largest source CSS files: `src/cohesion.css` 66,845 B / 11,349 B gzip; `src/styles.css` 59,506 B / 10,940 B gzip; `src/app-system.css` 30,889 B / 6,560 B gzip. `src/cohesion.css` contains broad actor public/preview, lesson, coach material, and gift sections; `src/styles.css` contains older overlapping actor/public rules. These are candidates for route-scoped extraction and consolidation, subject to visual comparison. Source-file size alone is not the optimization criterion.

The original warning targets are 120,000 B gzip JS and 22,000 B gzip CSS. Hard failures remain 130,000 B and 25,000 B; PR7 will not change those thresholds.

## Route baseline

The first measurement-only [browser run](https://github.com/coach-sudo/Studio-Portal/actions/runs/35855634169) passed, but its ephemeral build inherited the rollback default `VITE_QUERY_LAYER_V2=false`. That makes its authenticated request counts a **legacy-reader profile**, not evidence of the V2 query contract. Desktop cold-load measurements were: login 12 requests / 693.6 KiB same-origin transfer; public booking 20 / 740.9 KiB; public actor 47 / 697.4 KiB; student Home 81 / 861.4 KiB; Lesson Hub 82 / 861.8 KiB; Inbox 82 / 687.5 KiB; coach Home 52 / 702.2 KiB; coach student workspace 65 / 823.6 KiB. The mobile run used the same fixture family and is retained in the artifact.

Subsequent PR7 ephemeral builds explicitly use `VITE_QUERY_LAYER_V2=true` **only in CI**. Production flags remain unchanged.

The first V2 [browser run](https://github.com/coach-sudo/Studio-Portal/actions/runs/35856534348) passed. Browser cache unexpectedly produced zero-byte asset entries on later routes, so **its transfer columns are not a valid cold-load baseline**. The corrected cache-disabled [measurement-only rerun](https://github.com/coach-sudo/Studio-Portal/actions/runs/35857400050) passed, including cleanup, and supplies the authoritative V2 route baseline below. `Data` counts all `/api/`, Supabase Auth, and Supabase REST requests, not just PR2 domain queries. Transferred bytes are same-origin Resource Timing bytes as explained above.

| Route                   | Desktop requests / data / bytes | Mobile requests / data / bytes |
| ----------------------- | ------------------------------: | -----------------------------: |
| Login                   |                12 / 1 / 717,828 |               12 / 1 / 717,780 |
| Public booking          |                20 / 1 / 752,988 |               20 / 1 / 759,622 |
| Public actor            |                22 / 9 / 715,062 |               22 / 9 / 715,074 |
| Student Home            |               51 / 12 / 883,203 |              52 / 12 / 883,215 |
| Student Lesson Hub      |               53 / 14 / 883,641 |              54 / 14 / 883,653 |
| Student Inbox           |               52 / 13 / 883,775 |              52 / 13 / 883,787 |
| Coach Home              |               26 / 11 / 719,931 |              29 / 11 / 719,943 |
| Coach student workspace |               38 / 10 / 844,253 |              40 / 10 / 844,265 |

Static production gzip sizes remain the authoritative bundle-size comparison. Browser-transfer values reflect the ephemeral Netlify Dev transport and are comparative, not production CDN estimates.

## After optimization

Measured optimization code head: `288bfc7` (this documentation commit follows). The deployed [desktop/mobile and axe run](https://github.com/coach-sudo/Studio-Portal/actions/runs/35885228927) and [verify/migration run](https://github.com/coach-sudo/Studio-Portal/actions/runs/35885228942) passed. The run artifacts contain route JSON, screenshots, traces on retry, status JSON, and cleanup evidence.

| Built asset         | PR6 gzip bytes | PR7 gzip bytes |  Change |
| ------------------- | -------------: | -------------: | ------: |
| Entry JavaScript    |        125,061 |        115,654 |  -9,407 |
| Global CSS          |         24,884 |         21,402 |  -3,482 |
| StudentWorkspace JS |         18,910 |          8,412 | -10,498 |
| StudentPortal JS    |         18,588 |          5,029 | -13,559 |
| StudioOperations JS |         16,489 |         16,629 |    +140 |
| BookingCenter JS    |         12,721 |         12,777 |     +56 |
| CoachSection JS     |         11,765 |         11,867 |    +102 |
| PublicBooking JS    |         11,303 |         11,338 |     +35 |
| DOMPurify JS        |         10,610 |         10,610 |       0 |

The entry is 4,346 B below the unchanged 120,000 B warning threshold; global CSS is 598 B below 22,000 B. The hard-failure headroom is 14,346 B and 3,598 B respectively. Additional low-frequency chunks now carry feature UI: `AppShell` 1,905 B gzip, public actor CSS 2,246 B, actor editor preview CSS about 1 KB, and `StudioOperations` CSS 2,558 B (including the material library). `dist/bundle-analysis.json` is the repeatable machine-readable output, not a committed build artifact.

### Cold route comparison, V2 enabled only in ephemeral CI

Each row is `before → after`. Data counts include all `/api/`, Supabase Auth, and Supabase REST traffic; none of the V2 authenticated routes increased its data-request count. Transfer is same-origin bytes, not a CDN-gzip or cross-origin total.

| Project | Route                   | Requests | Data    | Transfer bytes    | Change |
| ------- | ----------------------- | -------- | ------- | ----------------- | -----: |
| Desktop | Login                   | 12 → 12  | 1 → 1   | 717,828 → 647,385 |  -9.8% |
| Desktop | Public booking          | 20 → 22  | 1 → 1   | 752,988 → 692,707 |  -8.0% |
| Desktop | Public actor            | 22 → 18  | 9 → 1   | 715,062 → 691,279 |  -3.3% |
| Desktop | Student Home            | 51 → 44  | 12 → 12 | 883,203 → 720,651 | -18.4% |
| Desktop | Student Lesson Hub      | 53 → 52  | 14 → 14 | 883,641 → 770,659 | -12.8% |
| Desktop | Student Inbox           | 52 → 53  | 13 → 13 | 883,775 → 745,988 | -15.6% |
| Desktop | Coach Home              | 26 → 43  | 11 → 11 | 719,931 → 712,356 |  -1.1% |
| Desktop | Coach student workspace | 38 → 51  | 10 → 10 | 844,253 → 774,572 |  -8.3% |
| Mobile  | Login                   | 12 → 12  | 1 → 1   | 717,780 → 647,397 |  -9.8% |
| Mobile  | Public booking          | 20 → 22  | 1 → 1   | 759,622 → 692,719 |  -8.8% |
| Mobile  | Public actor            | 22 → 18  | 9 → 1   | 715,074 → 691,291 |  -3.3% |
| Mobile  | Student Home            | 52 → 45  | 12 → 12 | 883,215 → 720,663 | -18.4% |
| Mobile  | Student Lesson Hub      | 54 → 53  | 14 → 14 | 883,653 → 770,671 | -12.8% |
| Mobile  | Student Inbox           | 52 → 53  | 13 → 13 | 883,787 → 746,000 | -15.6% |
| Mobile  | Coach Home              | 29 → 44  | 11 → 11 | 719,943 → 712,368 |  -1.1% |
| Mobile  | Coach student workspace | 40 → 53  | 10 → 10 | 844,265 → 774,584 |  -8.3% |

Desktop route-transferred JS/CSS bytes, using the same browser samples:

| Route                   | JS before → after | CSS before → after |
| ----------------------- | ----------------- | ------------------ |
| Login                   | 566,841 → 516,199 | 140,414 → 120,760  |
| Public booking          | 608,683 → 561,521 | 140,414 → 120,760  |
| Public actor            | 569,686 → 556,287 | 140,414 → 130,115  |
| Student Home            | 734,768 → 591,632 | 144,544 → 125,213  |
| Student Lesson Hub      | 734,768 → 641,202 | 144,544 → 125,213  |
| Student Inbox           | 734,768 → 616,397 | 144,544 → 125,213  |
| Coach Home              | 575,626 → 585,145 | 140,414 → 123,405  |
| Coach student workspace | 698,045 → 647,361 | 142,317 → 123,405  |

The CSS extraction moved public actor, draft-preview, and material-library rules from global styles into their owning feature imports, including responsive variants. The actor/public-profile rules are now co-located instead of scattered across three global stylesheets. A selector/declaration inventory before and after the move contained 2,026 selector-rule occurrences in each; no rule was deleted just because it looked duplicated. The initial scan found 240 repeated selector strings, but many encode deliberate responsive/cascade overrides. No exact duplicate with the same media context and declarations was found in the extracted public-actor or material styles, so further rule removal would be speculative. Imported logo/actor image assets were not found in the entry bundle; the app continues to use supplied URLs, and non-critical actor gallery images/embeds now load lazily without changing fidelity.

JavaScript changes keep coach, student, and public feature bodies behind route boundaries; student and coach nested tabs are lazy with an in-shell loading fallback. Coach and portal navigation ownership is separate. The live public actor route no longer launches authenticated studio-domain hooks; a focused contract test and deployed measurement cover that behavior. PR2's query flags, domain keys, targeted invalidation, and cancellation were not changed.

The coach route tradeoff is explicit: lazy shell/icon chunks increased asset requests by 17 on desktop Coach Home and 13 on the desktop student workspace, although their data counts stayed flat and transferred bytes decreased 1.1% and 8.3%. An eager-shell experiment lowered chunk requests but reintroduced coach CSS into the global entry, leaving only 59 B below the CSS warning threshold and loading coach code on public routes. It was not retained. A future optimization should group shared icons only after measuring render latency under realistic network conditions; PR7 does not claim a render-time improvement it did not measure.

### Verification and visual review

| Check                                                                   | Result                                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Full Vitest                                                             | Passed: 286 tests in 53 files                                                                  |
| TypeScript, ESLint, Prettier                                            | Passed; ESLint reports 598 warnings, zero errors                                               |
| Production build and unchanged JS/CSS budgets                           | Passed, both below warning limits                                                              |
| Secret scan and production dependency audit                             | Passed; zero production vulnerabilities                                                        |
| Supabase local reset, lint, pgTAP/RLS, generated-type diff in GitHub CI | Passed; PR7 made no database change                                                            |
| Deployed desktop/mobile Playwright and axe                              | Passed: 40 cases; 12 of 13 journeys passed                                                     |
| Stripe test checkout, journey 8 provider step                           | Blocked: no staging Stripe test-mode secret; payment context passed                            |
| Fixture cleanup                                                         | Passed: public/storage/auth restored to pre-fixture baseline; zero remaining `e2e-` auth users |

PR6 visual screenshots and final PR7 artifacts were compared for the mobile coach student record, mobile booking, mobile Inbox, and sparse public actor page; only names/timestamps unique to each fixture run differed. Local demo inspection additionally covered desktop/mobile Student Home, coach Materials, actor editor, and sparse actor page. No visual regression was found in those samples. The deployed visual/axe suite also covered student Schedule/Lesson Hub, Payments, Settings/timezone, guardian context, coach contextual lesson actions, and notification/mobile safe areas. Production, its credentials/data/settings, and the production query flag were not touched; no PR was merged and PR8 was not started.
