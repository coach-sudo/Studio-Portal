import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import type { RepairResult } from "../../src/domain/systemHealth";
import {
  calendarReviewRequest,
  reviewCalendarConflict,
} from "./_shared/calendar-conflict-review";
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
      action !== "calendar-review"
    )
      throw new AppError("NOT_FOUND", {
        status: 404,
        message: "Unknown System Health action.",
      });
    if (request.method !== (action === "status" ? "GET" : "POST"))
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
    if (!googleConfigured())
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
