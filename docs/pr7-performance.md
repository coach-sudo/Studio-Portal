# PR7 performance and stylesheet review

## Measurement method

- `npm run build && npm run bundle:analyze && npm run bundle:check` records every built asset's raw/gzip size in `dist/bundle-analysis.json` and enforces the unchanged warning/failure budgets.
- `e2e/pr7-performance.spec.ts` opens a new browser context for each representative route, waits for its first heading and fonts, then samples after 500 ms. It records browser request counts and Performance Resource Timing `transferSize` for same-origin resources. Cross-origin providers may omit transferred bytes without a Timing-Allow-Origin header, so the byte comparison is a same-origin lower bound, not a total network bill.
- Desktop and mobile samples use the same deterministic `e2e-` fixture family and routes before and after optimization. GitHub's free ephemeral Supabase/Netlify Dev runner is used; production is never a test target.

## Baseline — accepted PR6 head `c5a49ce`

| Built asset | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Entry JavaScript | 425,393 | 125,061 |
| Global CSS | 140,114 | 24,884 |
| StudentWorkspace JS | 79,966 | 18,910 |
| StudentPortal JS | 73,832 | 18,588 |
| StudioOperations JS | 64,397 | 16,489 |
| BookingCenter JS | 49,697 | 12,721 |
| CoachSection JS | 42,560 | 11,765 |
| PublicBooking JS | 39,134 | 11,303 |
| DOMPurify JS | 26,818 | 10,610 |

Largest source CSS files: `src/cohesion.css` 66,845 B / 11,349 B gzip; `src/styles.css` 59,506 B / 10,940 B gzip; `src/app-system.css` 30,889 B / 6,560 B gzip. `src/cohesion.css` contains broad actor public/preview, lesson, coach material, and gift sections; `src/styles.css` contains older overlapping actor/public rules. These are candidates for route-scoped extraction and consolidation, subject to visual comparison. Source-file size alone is not the optimization criterion.

The original warning targets are 120,000 B gzip JS and 22,000 B gzip CSS. Hard failures remain 130,000 B and 25,000 B; PR7 will not change those thresholds.

## Route baseline

Pending the first measurement-only deployed run. The run artifact will contain `route-performance.json` for desktop and mobile.

## After optimization

Pending measured changes. Record exact asset and route deltas here before PR7 review.
