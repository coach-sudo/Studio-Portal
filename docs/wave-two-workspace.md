# Wave 1 + Wave 2 combined candidate

## Disposition

Wave 2's three workstreams are implemented together on `codex/wave-two-workspace`, directly based on draft PR #56, `e0567286feeb3d2a8b8314aebb833e0f89fb3aa3`. PR #55 remains `06e51be1eaad66abef39abff1e6fadb89349e131`; both dependencies were reverified open/draft. No obsolete branch was imported.

**Application candidate: `95188fbf08206aca8d47adfc729e12a82f7e0d60`.** Subsequent documentation-only commits do not change this application pin. This incorporates the reviewed Wave 1 application foundation `f5324b203387a158df3c050569b95a9044368bc0`. No separate Wave 1 release is proposed. Code review is GO; hosted deployment and production are NO-GO pending the gates below.

## Implemented

- Shared authorized record targets for students, lessons, bookings, canonical resources and notes; exact detail reads work independently of a list page. Search and attention links use the same resolver and safe unavailable state. Return paths reject external origins.
- URL search, filters, sorting, pagination and selection across roster, lesson/calendar lists, Library, Inbox and note details. Existing bulk selection and command authority remain intact. Detail history, origin state and scroll restoration are shared; explicit return links and Back/Forward work across nested records. Unsaved coach notes warn on close/navigation, including Browser Back.
- Six coach destinations: Today, Calendar, Students, Inbox, Library, Studio. Studio groups the existing administrative destinations. `/coach` becomes Today while retaining queries; existing feature/legacy URLs remain supported. Mobile More is a real grouped menu. Useful Home operational information and week preview now sit in Today.
- Portal My Work/Messages labels, secondary More destinations and a persistent authorized guardian student selector. The bounded context RPC verifies the selected child before loading its workspace; URL and query keys include that child. Identity changes, forged contexts and revoked relationships fail closed. Student and guardian data never fall back to an unrelated first record.
- RLS/security-invoker global record search: two-character threshold, 250 ms debounce, five results per entity group (25 maximum initial records), twenty per expanded page, cancellation and identity/student-scoped keys. Keyboard arrows/Enter open exact results. Empty queries retain permitted destinations. Published-note snippets are plain text and capped at 240 characters; no signed URLs, file bodies, booking tokens or guest emails are returned.

The existing credit, bulk, occurrence, invoice, communication and provider command implementations are unchanged. Canonical resource detail is reused; new viewers and private study tools remain Wave 3 scope.

## Fresh verification

| Check                            | Result                                                                                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL 17 disposable cluster | All 58 migrations replayed; 60 assertions PASS, including real authenticated roles, foreign-studio/child denials, unpublished notes, selected context, paging, exact targets, fresh revocation and invoker authority                |
| RPC types                        | Three additive signatures generated from the isolated PostgreSQL catalog; existing generated contracts preserved                                                                                                                    |
| Focused unit/integration         | 56 PASS in each supported query mode, covering navigation, search transport/contracts, return context, calendar drawers, attention links, content density and dirty content                                                         |
| Local browser                    | 27/27 PASS: Chromium legacy and v2, WebKit v2; actual app/router components with loopback-only network fencing                                                                                                                      |
| Browser journeys                 | Coach search → student → exact lesson → filtered origin; Today preparation save and return; mobile More/search; resource/related-record return; guardian switching/refresh/Back/Forward/forged-context denial; unsaved-note refusal |
| Responsive/a11y                  | 320, 390, 768, 1440 px, no page overflow on tested Today routes; keyboard search and dialog Escape; zero serious/critical axe findings on tested Today/search, student Work and guardian views                                      |
| Typecheck/build                  | PASS; production-shaped configured-client build with inert CI public placeholders and `VITE_QUERY_LAYER_V2=true`                                                                                                                    |
| Lint                             | PASS with zero errors; repository-wide warnings remain (782 at the full run). Focused final history/bootstrap lint also passed                                                                                                      |
| Format/secret checks             | PASS; no private credentials or journals committed                                                                                                                                                                                  |
| Bundles                          | PASS: largest JS 111,672 bytes gzip; CSS 23,156 bytes gzip. Existing 22 KB CSS warning retained; 130 KB JS / 25 KB CSS failure caps unchanged                                                                                       |

The browser adapter selects guardian role only on an unconfigured loopback development server and renders real portal/store/router components. It is not hosted Auth evidence. The database tests use real PostgreSQL role/RLS execution, not client filtering. Initial browser failures found nested interactive search options and a Back-navigation draft-loss defect; both were corrected and the final full 27-case matrix passed. External fonts are blocked in local acceptance.

Evidence: [database](wave-two-database-validation.json), [combined verification](wave-two-workspace-verification.json). Full local test logs and browser artifacts remain local. Historical unchanged Wave 1 financial, concurrency, H01–H16, Linux packaging and provider limitations are retained, without redundant full-suite reruns. GitHub CI and full Supabase CLI lint/type regeneration are separate gates; the new internal schema is included in CI/local schema-lint configuration.

## Wave 1 remains blocked at cleanup

[The updated Wave 1 report](wave-one-finalization.md) and [continuation evidence](wave-one-hosted-ui-continuation.json) supersede its earlier ACL/perimeter-only state.

UI01–UI04 PASS; UI05 partially executed/BLOCKED; UI06–UI09 NOT RUN/BLOCKED. The one continuation exhausted **600/600 reads** during UI05; its active transaction rolled back. Other charged totals: **19/30 HTTP attempts** (5 sessions, 14 business), **10/60 SQL mutations**, **4/8 Auth writes**, **0/40 cleanup transactions**.

Four temporary Auth users, two students, thirteen lessons, four granted lesson credits and owned dependencies remain. The last committed snapshot preserves the original 215 rows/76-table baseline. Independent post-stop preservation and cleanup were not performed. No provider, delivery or global worker ran; no budget was reset or expanded. Exact owned identities, recovery inventory and the original journal/receipt remain private.

**Wave 1 core acceptance is incomplete.** The sealed cleanup requires UI01–UI08 completion markers and cannot recover this incomplete workflow within its exhausted read limit. Further hosted work needs separately authorized, narrowly bounded cleanup-only recovery and an independently reviewed incomplete-run path. Do not manufacture markers, erase financial/audit history, restart this run, or extend its original `2026-10-19T16:33:05.780Z` expiry.

## Future protected staging procedure and remaining gates

1. Resolve the retained Wave 1 fixtures through the separately reviewed cleanup-only recovery, including independent original-row/Auth/migration preservation verification. Decide explicitly how unfinished UI05–UI09 acceptance will be completed; the exhausted run is not reusable authorization for additional reads.
2. Review this implementation and its one new migration, `20261018222228_workspace_navigation_search.sql`. It remains **unapplied** to hosted staging and production. Complete CI migration lint/pgTAP/types checks and approve the exact staging schema change before applying it. Existing 57 hosted migration records are preserved.
3. Separately authorize an exact combined candidate staging build/deployment. Reverify targets and protection first: Supabase `lrxrivfqjpkvygozphoz`, Netlify `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`, all-deploy team login, stopped automatic builds and absent provider credentials. Rebuild the pinned source on reviewed Linux x64/Node 22 with approved staging browser-public settings and preview-scoped function secrets. **Do not upload this local CI-placeholder bundle.** Existing serverless source and dependencies are unchanged; fresh Linux packaging is deferred to that authorized deployment.
4. Permit exactly one unpublished protected `deploy-preview`, verify its actual returned ID/origin, candidate health and old publication preservation, then separately authorize exact-host Auth configuration if needed. No deployment ID or wildcard redirect is assumed here.
5. Run bounded hosted combined acceptance against the approved new migration/application, especially search/selected-child permissions and direct-route denial. Local fixtures do not close that gate. Native 200% zoom, screen-reader/human usability sign-off, retained Netlify toolbar finding, nonzero-money history, isolated providers/delivery and scheduled cadence remain explicit release gates.

Production targets remain excluded. No deployment, publication, merge, hosted migration/Auth update, additional hosted fixture mutation or Wave 3 work is included in this delivery. The complete six-wave master-plan scope remains required.
