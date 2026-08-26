import type { Config, Context } from "@netlify/functions";
import { apiError, correlationId, json } from "./_shared/http";
import { serviceClient, userClient } from "./_shared/supabase";

export default async (request: Request, context: Context) => {
  const id = correlationId(request, context.requestId);
  try {
    if (request.method !== "GET")
      return json(
        {
          code: "METHOD_NOT_ALLOWED",
          message: "Method not allowed.",
          retryable: false,
          correlationId: id,
        },
        405,
      );
    const lessonId = context.params.lessonId;
    const access = await userClient(request)
      .from("lessons")
      .select("id,updated_at,version")
      .eq("id", lessonId)
      .single();
    if (access.error || !access.data) throw new Error("FORBIDDEN");
    const db = serviceClient();
    const [{ data: calendar }, { data: emails }] = await Promise.all([
      db
        .from("calendar_projections")
        .select("status,last_projected_at,last_error,attempts")
        .eq("lesson_id", lessonId)
        .maybeSingle(),
      db
        .from("outbox_messages")
        .select("status,event_key,updated_at,last_error,correlation_id")
        .eq("lesson_id", lessonId)
        .like("event_key", "lesson.%")
        .order("updated_at", { ascending: false })
        .limit(8),
    ]);
    return json({
      lessonId,
      lessonVersion: access.data.version,
      calendar: calendar || { status: "not_required" },
      email: emails || [],
      correlationId: emails?.[0]?.correlation_id || null,
    });
  } catch (error) {
    return apiError(error, id);
  }
};

export const config: Config = {
  path: "/api/v2/portal/lessons/:lessonId/delivery",
};
