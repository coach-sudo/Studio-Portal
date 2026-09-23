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

Subsequent PR7 ephemeral builds explicitly use `VITE_QUERY_LAYER_V2=true` **only in CI**. A second measurement-only run will establish the V2 before-values before any optimization. Production flags remain unchanged.

The first V2 [browser run](https://github.com/coach-sudo/Studio-Portal/actions/runs/35856534348) passed. Browser cache unexpectedly produced zero-byte asset entries on later routes, so **its transfer columns are not a valid cold-load baseline**. The corrected cache-disabled [measurement-only rerun](https://github.com/coach-sudo/Studio-Portal/actions/runs/35857400050) passed, including cleanup, and supplies the authoritative V2 route baseline below. `Data` counts all `/api/`, Supabase Auth, and Supabase REST requests, not just PR2 domain queries. Transferred bytes are same-origin Resource Timing bytes as explained above.

| Route                   | Desktop requests / data / bytes | Mobile requests / data / bytes |
| ----------------------- | ------------------------------: | -----------------------------: |
| Login                   |             12 / 1 / 717,828 |            12 / 1 / 717,780 |
| Public booking          |             20 / 1 / 752,988 |            20 / 1 / 759,622 |
| Public actor            |             22 / 9 / 715,062 |            22 / 9 / 715,074 |
| Student Home            |            51 / 12 / 883,203 |           52 / 12 / 883,215 |
| Student Lesson Hub      |            53 / 14 / 883,641 |           54 / 14 / 883,653 |
| Student Inbox           |            52 / 13 / 883,775 |           52 / 13 / 883,787 |
| Coach Home              |            26 / 11 / 719,931 |           29 / 11 / 719,943 |
| Coach student workspace |            38 / 10 / 844,253 |           40 / 10 / 844,265 |

Static production gzip sizes remain the authoritative bundle-size comparison. Browser-transfer values reflect the ephemeral Netlify Dev transport and are comparative, not production CDN estimates.

## After optimization

Pending measured changes. Record exact asset and route deltas here before PR7 review.
