-- Hosted production grants EXECUTE directly to anon through its existing
-- default-function privileges. Revoking PUBLIC in the original migration does
-- not remove that separate anon ACL. This route RPC is authenticated-only.
revoke execute on function public.studio_route_snapshot(text[]) from anon;
