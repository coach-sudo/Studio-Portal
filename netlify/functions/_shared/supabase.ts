import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.generated";

function environment() {
  const url = Netlify.env.get("SUPABASE_URL");
  if (!url) throw new Error("Supabase is not configured.");
  return url;
}

export function typedUserClient(request: Request): SupabaseClient<Database> {
  const url = environment();
  const key = Netlify.env.get("SUPABASE_ANON_KEY");
  if (!key) throw new Error("Supabase is not configured.");
  return createClient<Database>(url, key, {
    global: {
      headers: { Authorization: request.headers.get("authorization") || "" },
    },
    auth: { persistSession: false },
  });
}

export function typedServiceClient(): SupabaseClient<Database> {
  const url = environment();
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Compatibility adapters for older functions while their table payloads are
// migrated incrementally to the generated public-schema contracts.
export function userClient(request: Request): SupabaseClient {
  return typedUserClient(request) as unknown as SupabaseClient;
}

export function serviceClient(): SupabaseClient {
  return typedServiceClient() as unknown as SupabaseClient;
}
