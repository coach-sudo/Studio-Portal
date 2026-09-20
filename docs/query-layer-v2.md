# Query layer V2

`VITE_QUERY_LAYER_V2=true` enables the route-specific reader. Keep it enabled only on the dedicated staging site until the deployed checks and manual route review pass. Production remains on the legacy snapshot reader until separately authorized.

## Architecture and contracts

- Each requested domain has its own typed React Query cache entry: identity/settings, students, lessons, booking, work, finance, messaging, actor profiles, households, referrals, and administration. Named hooks expose those domain results, while `useStudioRoute` composes them into the existing `StudioSnapshot` shape so route migration does not require a simultaneous UI rewrite.
- Domain query keys include role, student scope, and domain. Paginated keys additionally include table/view, page, page size, filters, search, and ordering.
- The browser calls the `studio_route_snapshot` security-invoker RPC with one declared domain per request. PostgreSQL RLS remains authoritative inside the function.
- The compatibility reader remains available when `VITE_QUERY_LAYER_V2=false` for one stable release cycle.
- V2 has no snapshot polling interval. Stale queries refresh on focus or reconnect; an aborted navigation cancels obsolete Supabase requests.
- Signed material URLs are fetched only when a stored file is opened and cached until five minutes before their one-hour expiry.
- Only the currently open inbox conversation subscribes to Realtime. Navigation removes its channel.
- Shared collection queries use server-side filters, ordering, exact counts, and `.range()`. Coach pages default to 25 rows and portal pages to 10; pagination controls render only when `total > pageSize`.
- Roster import and merge load the full RLS-scoped student domain only after the coach opens those tools. The normal roster remains page-sized.

## Implemented route coverage

- Coach roster: server-paged student rows, exact status counts, server search/filter/order, 25-row default.
- Coach notes: server-paged note rows, exact count, server search/filter/order, 25-row default.
- Coach material library: RLS-preserving security-invoker view, server search/filter/order, exact role counts, 25-row default, on-demand signed file URLs.
- Portal notes: server-paged published notes, exact count, server search/order, 10-row default.
- All major authenticated routes declare their domains. Mutation paths invalidate no more than two affected domains, and broad `['studio']` invalidation is removed.

## PR2 acceptance checklist

Status values are `passed`, `not run`, `infrastructure-blocked`, or `manually required`. Do not infer success from configuration alone.

| Requirement                                                                  | Status            | Evidence or remaining action                                                                                            |
| ---------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Typed domain hooks for all 11 domain groups                                  | passed            | Named hooks and per-domain keys are in `src/hooks/useStudio.ts`; route composition preserves compatibility.             |
| Browser-safe Supabase client with RLS authoritative                          | passed            | Security-invoker RPC/view plus pgTAP isolation assertions; no service-role key is used by client code.                  |
| Coach 25-row and portal 10-row server pagination                             | passed            | Roster, coach notes/materials, and portal notes use exact counts, server filters/search/order, and `.range()`.          |
| Hide pagination for zero or one page                                         | passed            | Shared `shouldShowPagination` contract and screen use.                                                                  |
| Five-minute identity/settings cache and 30-minute GC                         | passed            | Identity uses a five-minute stale time; all V2 domain entries use 30-minute GC.                                         |
| Targeted settings/service/package invalidation                               | passed            | Mutations use `invalidateStudioDomains`; no broad studio invalidation remains.                                          |
| Signed URLs loaded on demand and cached to five minutes before expiry        | passed            | Material open path uses the signed-URL cache instead of snapshot refresh.                                               |
| Remove full-snapshot timers                                                  | passed            | Timers exist only in the disabled rollback branch.                                                                      |
| Bounded lesson-delivery polling                                              | passed            | Existing visible-page delivery polling remains bounded and terminal-state aware.                                        |
| Visible-inbox Realtime subscription and cleanup                              | passed            | Subscription is scoped to the selected conversation and removed on cleanup; additive publication migration is included. |
| Abort signals, complete query keys, retained previous pages, race prevention | passed            | Domain and page loaders accept abort signals; page keys include inputs; previous data is retained.                      |
| Staging-first feature flag and one-release rollback reader                   | manually required | Set `VITE_QUERY_LAYER_V2=true` only on staging/Deploy Previews. Production must remain false until separately approved. |
| At most eight initial authenticated data requests                            | passed            | Contract test measures 8 coach domain requests and 5 portal requests.                                                   |
| At most two targeted refetches after a mutation                              | passed            | Active-query test measures one domain refetch plus one affected page refetch, with identity unchanged.                  |
| No timer reloads unrelated domains                                           | passed            | V2 domain options have no interval; contract test protects the rollback-only timer.                                     |
| Each screen requests only declared domains                                   | passed            | Route-contract tests inspect representative shell, inbox, referral, roster, notes, and material routes.                 |
| Portal users cannot read coach-only or unrelated-student data                | not run           | pgTAP coverage is committed. The GitHub `migrations` job must pass against a fresh local Supabase stack.                |
| Generated public-schema types match migrations                               | not run           | Committed types include the new view. The GitHub `migrations` job regenerates them and fails on diff.                   |
| Deployed staging request counts and workflows                                | manually required | Confirm with browser network tools after the dedicated staging Deploy Preview is available.                             |

## Verification record

Local Windows verification for the final PR2 revision:

- TypeScript: passed.
- ESLint: passed.
- Prettier check: passed.
- Vitest: passed, 238 tests in 41 files.
- Production build: passed.
- Bundle budget: passed with the existing warning thresholds exceeded (entry JavaScript 124,547 gzip bytes; global CSS 23,725 gzip bytes), both below failure thresholds.
- Secret scan: passed.
- Production dependency audit: passed, zero vulnerabilities.
- Supabase reset/lint/pgTAP/type regeneration: infrastructure-blocked locally because Docker and Podman are unavailable; GitHub-hosted `migrations` is the required gate.

## Rollout and rollback

1. Require the GitHub `verify` and `migrations` jobs to pass for this PR revision.
2. Apply the additive Realtime-publication, route-RPC, and paginated-view migrations only to the dedicated non-production database.
3. Set `VITE_QUERY_LAYER_V2=true` only for staging and its Deploy Previews.
4. Verify request counts, focused mutation refetches, and desktop/mobile workflows on the deployed preview.
5. Enable production only after explicit approval.
6. To roll back, set `VITE_QUERY_LAYER_V2=false` and redeploy the same protected commit. Leave the additive database objects in place.
