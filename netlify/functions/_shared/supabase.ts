import { createClient } from "@supabase/supabase-js";
export function userClient(request: Request) {
  const url = Netlify.env.get("SUPABASE_URL"); const key = Netlify.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) throw new Error("Supabase is not configured.");
  return createClient(url,key,{global:{headers:{Authorization:request.headers.get("authorization")||""}},auth:{persistSession:false}});
}
export function serviceClient() {
  const url=Netlify.env.get("SUPABASE_URL"); const key=Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) throw new Error("Supabase service role is not configured.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
