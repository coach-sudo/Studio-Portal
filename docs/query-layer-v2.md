# Query layer V2

`VITE_QUERY_LAYER_V2=true` enables the route-specific reader. Keep it enabled only on the dedicated staging site until the deployed checks and manual route review pass. Production remains on the legacy snapshot reader until separately authorized.

## Contracts

- Route query keys include role, student scope, and a sorted domain list.
- The browser calls the `studio_route_snapshot` security-invoker RPC with only the route's declared domains. PostgreSQL RLS remains authoritative inside the function.
- The compatibility reader remains available when `VITE_QUERY_LAYER_V2=false` for one stable release cycle.
- V2 has no snapshot polling interval. Stale queries refresh on focus or reconnect; an aborted navigation cancels the obsolete Supabase request.
- Signed material URLs are cached for 55 minutes when created with a 60-minute expiry, so background refreshes do not continually resign files.
- Only the currently open inbox conversation subscribes to Realtime. Navigation removes its channel.
- Shared collection queries use server-side filters, ordering, exact counts, and `.range()`. Coach pages default to 25 rows and portal pages to 10; pagination controls render only when `total > pageSize`.

## Route domains

The available domains are identity/settings, students, lessons, booking, work, finance, messaging, actor profiles, households, referrals, and administration. Routes must declare only the domains they render. Query-contract tests protect the focused inbox, referrals, application shell, role/page key composition, timer behavior, and pagination defaults.

## Rollout and rollback

1. Apply the additive Realtime-publication and route-RPC migrations to a non-production database.
2. Set `VITE_QUERY_LAYER_V2=true` only for staging and its Deploy Previews.
3. Verify initial request counts, focused mutation refetches, RLS tests, and desktop/mobile workflows.
4. Enable production only after explicit approval.
5. To roll back, set `VITE_QUERY_LAYER_V2=false` and redeploy the same protected commit. Leave the additive database objects in place.
