import type { Config } from "@netlify/functions";
import Stripe from "stripe";
import { googleAccessToken, googleFreeBusy } from "./_shared/google";
import { serviceClient } from "./_shared/supabase";

const has = (...names: string[]) =>
  names.some((name) => Boolean(Netlify.env.get(name)));

export default async () => {
  const issues: string[] = [];
  let supabase =
    has("SUPABASE_URL") &&
    has("SUPABASE_ANON_KEY") &&
    has("SUPABASE_SERVICE_ROLE_KEY");
  if (supabase) {
    try {
      const { error } = await serviceClient()
        .from("studios")
        .select("id")
        .limit(1);
      if (error) throw error;
    } catch (error) {
      supabase = false;
      issues.push(
        `Supabase: ${error instanceof Error ? error.message : "connection failed"}`,
      );
    }
  }
  let stripe = has("STRIPE_SECRET_KEY") && has("STRIPE_WEBHOOK_SECRET");
  if (stripe) {
    try {
      await new Stripe(Netlify.env.get("STRIPE_SECRET_KEY")!, {
        apiVersion: "2026-07-29.dahlia",
      }).customers.list({ limit: 1 });
    } catch (error) {
      stripe = false;
      issues.push(
        `Stripe: ${error instanceof Error ? error.message : "connection failed"}`,
      );
    }
  }
  const googleOAuth =
    has("GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID") &&
    has("GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET") &&
    has("GOOGLE_REFRESH_TOKEN");
  let googleCalendar = googleOAuth && has("GOOGLE_CALENDAR_ID"),
    gmail = googleOAuth;
  if (googleOAuth) {
    try {
      const token = await googleAccessToken();
      const tokenInfoResponse = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
        ),
        tokenInfo = (await tokenInfoResponse.json()) as { scope?: string },
        scopes = new Set((tokenInfo.scope || "").split(" "));
      const canWriteCalendar =
          scopes.has("https://www.googleapis.com/auth/calendar") ||
          scopes.has("https://www.googleapis.com/auth/calendar.events"),
        canSendGmail =
          scopes.has("https://www.googleapis.com/auth/gmail.send") ||
          scopes.has("https://mail.google.com/"),
        canReadGmail =
          scopes.has("https://www.googleapis.com/auth/gmail.readonly") ||
          scopes.has("https://www.googleapis.com/auth/gmail.modify") ||
          scopes.has("https://mail.google.com/");
      if (!canWriteCalendar) {
        googleCalendar = false;
        issues.push(
          "Google Calendar: reconnect with Calendar read/write permission so availability, invitations, and Meet links can work.",
        );
      } else {
        try {
          const now = new Date(),
            after = new Date(now.getTime() + 60000);
          await googleFreeBusy(token, now.toISOString(), after.toISOString());
        } catch (error) {
          googleCalendar = false;
          issues.push(
            `Google Calendar: ${error instanceof Error ? error.message : "provider check failed"}`,
          );
        }
      }
      if (!canSendGmail) {
        gmail = false;
        issues.push(
          "Gmail: reconnect with Gmail send permission so confirmations and reminders can be delivered.",
        );
      }
      if (!canReadGmail) {
        gmail = false;
        issues.push(
          "Gmail: reconnect with read-only Gmail permission so confirmed, rescheduled, and cancelled provider lessons can be reconciled.",
        );
      }
    } catch (error) {
      googleCalendar = false;
      gmail = false;
      issues.push(
        `Google: ${error instanceof Error ? error.message : "connection failed"}`,
      );
    }
  }
  return Response.json(
    {
      mode: supabase ? "live" : "demo",
      supabase,
      stripe,
      googleCalendar,
      gmail,
      scheduledWorkers: supabase && googleCalendar && gmail,
      issues,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
};

export const config: Config = { path: "/api/v2/health" };
