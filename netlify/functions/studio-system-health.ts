import { syncInboundCalendar } from "./_shared/calendar-inbound";
import {
  activeCalendarRoles,
  manageCalendarRoles,
} from "./_shared/calendar-roles";
import { GoogleAuthorizationError, googleAccessToken } from "./_shared/google";
import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import type { GmailCheck, RepairResult } from "../../src/domain/systemHealth";
import {
  calendarReviewRequest,
  reviewCalendarConflict,
} from "./_shared/calendar-conflict-review";
import {
  beginCalendarOAuth,
  calendarOAuthConfig,
  calendarOAuthStudio,
} from "./_shared/calendar-oauth";
import {
  beginGmailOAuth,
  gmailConnection,
  legacyGmailConfigured,
} from "./_shared/gmail-oauth";
import { apiError, AppError, json } from "./_shared/http";
import {
  googleConfigured,
  healthRpc,
  readStudioHealth,
  runStudioHealth,
} from "./_shared/studio-health";
import { serviceClient, typedUserClient } from "./_shared/supabase";
import { workerEnabled } from "./_shared/worker-controls";

const identifier = z.uuid();
const repair = z
  .object({ issue: identifier, service: z.enum(["calendar", "email"]) })
  .strict();
const unavailable = (id: string, status = 503) =>
  json(
    {
      code: "HEALTH_UNAVAILABLE",
      message:
        "System Health could not verify the result. Refresh before trying again.",
      correlationId: id,
      retryable: true,
    },
    status,
  );

export default async function studioSystemHealth(
  request: Request,
  context: Context,
) {
  // Generate the audit reference here. Never pass a browser-provided value into logs or diagnostics.
  const id = crypto.randomUUID();
  try {
    const action = context.params.action;
    const url = new URL(request.url);
    const studio = identifier.safeParse(url.searchParams.get("studio"));
    if (!studio.success)
      throw new AppError("VALIDATION_FAILED", {
        status: 400,
        message: "Select a studio.",
      });
    if (
      action !== "status" &&
      action !== "check" &&
      action !== "retry" &&
      action !== "calendar-review" &&
      action !== "calendar-oauth" &&
      action !== "calendar-roles" &&
      action !== "calendar-catch-up" &&
      action !== "gmail-status" &&
      action !== "gmail-check" &&
      action !== "gmail-oauth"
    )
      throw new AppError("NOT_FOUND", {
        status: 404,
        message: "Unknown System Health action.",
      });
    if (
      request.method !==
      (action === "status" || action === "gmail-status" ? "GET" : "POST")
    )
      throw new AppError("METHOD_NOT_ALLOWED", {
        status: 405,
        message: "Method not allowed.",
      });
    const bearer = request.headers.get("authorization");
    if (!bearer?.startsWith("Bearer "))
      throw new AppError("AUTHENTICATION_REQUIRED", {
        status: 401,
        message: "Sign in as a coach to open System Health.",
      });

    const userDb = typedUserClient(request, AbortSignal.timeout(2000));
    const actor = await userDb.auth.getUser(bearer.slice(7));
    if (actor.error || !actor.data.user) throw AppError.forbidden();
    const membership = await userDb
      .from("memberships")
      .select("id")
      .eq("studio_id", studio.data)
      .eq("user_id", actor.data.user.id)
      .eq("role", "coach")
      .maybeSingle();
    if (membership.error || !membership.data) throw AppError.forbidden();
    const db = serviceClient();
    if (
      action === "gmail-status" ||
      action === "gmail-check" ||
      action === "gmail-oauth"
    ) {
      if (studio.data !== (await calendarOAuthStudio(db)))
        throw AppError.forbidden();
      if (action === "gmail-oauth")
        return await beginGmailOAuth(request, db, studio.data, actor.data.user.id);
      if (action === "gmail-status")
        return json(await gmailConnection(db, studio.data, url.origin));
      let state: GmailCheck = "verified";
      try {
        await googleAccessToken(AbortSignal.timeout(5000), {
          gmailDeliveryStudio: studio.data,
        });
      } catch (error) {
        state =
          error instanceof GoogleAuthorizationError
            ? error.reason
            : "unavailable";
      }
      return json({ state });
    }
    if (action === "status") {
      const value = url.searchParams.get("issue");
      const issue = value === null ? undefined : identifier.safeParse(value);
      if (issue && !issue.success)
        throw new AppError("VALIDATION_FAILED", {
          status: 400,
          message: "Invalid issue reference.",
        });
      return json(await readStudioHealth(db, studio.data, issue?.data));
    }
    if (action === "check")
      return json(await runStudioHealth(db, studio.data, false));

    if (action === "calendar-catch-up") {
      if (studio.data !== (await calendarOAuthStudio(db)))
        throw AppError.forbidden();
      if (
        !workerEnabled("provider-intake") ||
        Netlify.env.get("GOOGLE_CALENDAR_INBOUND_ENABLED") !== "true"
      )
        return json({ state: "held" });
      const { incoming, outgoing } = await activeCalendarRoles();
      const payload = z
        .object({ calendar: z.string().min(1).max(1024) })
        .strict()
        .safeParse(await request.json().catch(() => null));
      const selected = payload.success && payload.data.calendar;
      const actual =
        selected && incoming.includes(selected)
          ? selected
          : selected &&
              incoming.includes("primary") &&
              selected === calendarOAuthConfig()?.account
            ? "primary"
            : null;
      if (!actual)
        throw new AppError("VALIDATION_FAILED", {
          status: 400,
          message: "Choose a calendar assigned to incoming changes.",
        });
      const token = await googleAccessToken(AbortSignal.timeout(5000));
      const result = await syncInboundCalendar(
        db,
        studio.data,
        actual,
        token,
        1,
        actual === outgoing,
      );
      return json({ state: "checked", ...result });
    }

    if (action === "calendar-roles")
      return json(
        await manageCalendarRoles(
          request,
          db,
          studio.data,
          actor.data.user.id,
          googleAccessToken,
        ),
      );

    if (action === "calendar-oauth")
      return await beginCalendarOAuth(
        request,
        db,
        studio.data,
        actor.data.user.id,
      );

    if (action === "calendar-review") {
      const payload = calendarReviewRequest.safeParse(
        await request.json().catch(() => null),
      );
      if (!payload.success)
        throw new AppError("VALIDATION_FAILED", {
          status: 400,
          message: "Choose a Calendar conflict to review.",
        });
      return json(
        await reviewCalendarConflict(
          db,
          studio.data,
          actor.data.user.id,
          id,
          payload.data,
        ),
      );
    }

    const payload = repair.safeParse(await request.json().catch(() => null));
    if (!payload.success)
      throw new AppError("VALIDATION_FAILED", {
        status: 400,
        message: "Choose one eligible recovery.",
      });
    if (
      !workerEnabled(
        payload.data.service === "calendar" ? "calendar" : "automations",
      )
    )
      return json({
        result: "worker_disabled" satisfies RepairResult,
        correlationId: id,
      });
    if (
      payload.data.service === "calendar"
        ? !googleConfigured()
        : studio.data === (await calendarOAuthStudio(db))
          ? (await gmailConnection(db, studio.data, url.origin))
              .authorization === "configuration"
          : !legacyGmailConfigured()
    )
      return json({
        result: "connection_required" satisfies RepairResult,
        correlationId: id,
      });
    const result = await healthRpc<RepairResult>(db, "studio_health_retry", {
      p_studio: studio.data,
      p_actor: actor.data.user.id,
      p_issue: payload.data.issue,
      p_correlation: id,
      p_service: payload.data.service,
    });
    return json({ result, correlationId: id });
  } catch (error) {
    if (error instanceof AppError) return apiError(error, id);
    console.error(
      JSON.stringify({
        event: "studio_health.request_failed",
        correlationId: id,
      }),
    );
    return unavailable(id);
  }
}
export const config: Config = { path: "/api/v2/studio-health/:action" };
