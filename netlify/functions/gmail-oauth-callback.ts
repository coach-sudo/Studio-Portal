import type { Config } from "@netlify/functions";
import { completeGmailOAuth } from "./_shared/gmail-oauth";
import { serviceClient } from "./_shared/supabase";

export default (request: Request) =>
  completeGmailOAuth(request, serviceClient());
// Netlify packages the route from this function's static config.
export const config: Config = { path: "/api/v2/gmail/oauth/callback" };
