import type { Config } from "@netlify/functions";
import { completeGmailOAuth, gmailOAuthPath } from "./_shared/gmail-oauth";
import { serviceClient } from "./_shared/supabase";

export default (request: Request) =>
  completeGmailOAuth(request, serviceClient());
export const config: Config = { path: gmailOAuthPath };
