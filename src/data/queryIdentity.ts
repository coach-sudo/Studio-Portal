import type { QueryClient } from "@tanstack/react-query";
import type { supabase } from "../lib/supabase";
const protectedClients = new WeakSet<QueryClient>();

export function ensureQueryIdentityIsolation(
  client: QueryClient,
  auth: NonNullable<typeof supabase>["auth"],
) {
  if (protectedClients.has(client)) return;
  protectedClients.add(client);
  isolateQueryIdentity(client, auth);
}

/** Remove authenticated query results when a different account starts using this browser. */
export function isolateQueryIdentity(
  client: QueryClient,
  auth: NonNullable<typeof supabase>["auth"],
) {
  let previous: string | null | undefined;
  return auth.onAuthStateChange((_event, session) => {
    const identity = session?.user.id ?? null;
    if (previous !== undefined && previous !== identity) client.clear();
    previous = identity;
  });
}
