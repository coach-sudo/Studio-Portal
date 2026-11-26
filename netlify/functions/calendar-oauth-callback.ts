import type { Config } from "@netlify/functions";
import { completeCalendarOAuth } from "./_shared/calendar-oauth";
import { serviceClient } from "./_shared/supabase";

export default (request: Request) =>
  completeCalendarOAuth(request, serviceClient());
export const config: Config = { path: "/api/v2/calendar/oauth/callback" };
