import type { Config } from "@netlify/functions";
import { apiError, correlationId, json } from "./_shared/http";
import { releaseMetadata } from "./_shared/release";
import { serviceClient, userClient } from "./_shared/supabase";
import { workerEnabled } from "./_shared/worker-controls";
import {
  workerHealth,
  type WorkerReceipt,
} from "../../src/domain/integrationHealth";
const has = (...names: string[]) =>
  names.some((n) => Boolean(Netlify.env.get(n)));
type Evidence = {
  state:
    | "working"
    | "configured_unverified"
    | "attention_required"
    | "unconfigured"
    | "disabled";
  configured: boolean;
  lastSuccessAt: string | null;
};
export const evidence = (
  configured: boolean,
  lastSuccessAt: string | null,
  failed: boolean,
): Evidence => ({
  configured,
  lastSuccessAt,
  state: !configured
    ? "unconfigured"
    : failed
      ? "attention_required"
      : lastSuccessAt
        ? "working"
        : "configured_unverified",
});
export default async (request: Request) => {
  const id = correlationId(request, crypto.randomUUID());
  try {
    if (!request.headers.get("authorization")?.startsWith("Bearer "))
      return json(
        {
          code: "UNAUTHENTICATED",
          message: "Sign in to view integration status.",
          retryable: false,
          correlationId: id,
        },
        401,
      );
    const user = userClient(request),
      membership = await user
        .from("memberships")
        .select("studio_id")
        .eq("role", "coach")
        .limit(1)
        .maybeSingle();
    if (membership.error || !membership.data) throw new Error("FORBIDDEN");
    const studioId = membership.data.studio_id,
      db = serviceClient();
    // These are scoped database observations. No token refresh, provider probe, delivery or worker invocation.
    const [studio, calendar, calendarFailure, email, emailFailure, workerRead] =
      await Promise.all([
        db.from("studios").select("id").eq("id", studioId).single(),
        db
          .from("calendar_projections")
          .select("last_projected_at,lessons!inner(studio_id)")
          .eq("lessons.studio_id", studioId)
          .not("last_projected_at", "is", null)
          .order("last_projected_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from("calendar_projections")
          .select("id,lessons!inner(studio_id)")
          .eq("lessons.studio_id", studioId)
          .eq("status", "failed")
          .limit(1)
          .maybeSingle(),
        db
          .from("outbox_messages")
          .select("updated_at")
          .eq("studio_id", studioId)
          .eq("status", "sent")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from("outbox_messages")
          .select("id")
          .eq("studio_id", studioId)
          .eq("status", "failed")
          .limit(1)
          .maybeSingle(),
        db.rpc("scheduled_worker_health"),
      ]);
    const receipts = (workerRead.data ?? {}) as Record<string, WorkerReceipt>;
    const workers = Object.fromEntries(
      (["provider-intake", "booking-maintenance"] as const).map((worker) => [
        worker,
        workerHealth(
          workerEnabled(worker),
          receipts[worker] ?? null,
          !!workerRead.error,
        ),
      ]),
    );
    const oauth =
      has("GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID") &&
      has("GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET") &&
      has("GOOGLE_REFRESH_TOKEN");
    const integrations = {
      supabase: evidence(
        has("SUPABASE_URL") && has("SUPABASE_SERVICE_ROLE_KEY"),
        studio.error ? null : new Date().toISOString(),
        !!studio.error,
      ),
      googleCalendar: evidence(
        oauth && has("GOOGLE_CALENDAR_ID"),
        calendar.data?.last_projected_at || null,
        !!calendar.error || !!calendarFailure.error || !!calendarFailure.data,
      ),
      gmail: evidence(
        oauth,
        email.data?.updated_at || null,
        !!email.error || !!emailFailure.error || !!emailFailure.data,
      ),
      stripe: evidence(
        has("STRIPE_SECRET_KEY") && has("STRIPE_WEBHOOK_SECRET"),
        null,
        false,
      ),
      scheduledWorkers: {
        configured: !workerRead.error,
        lastSuccessAt:
          workers["booking-maintenance"].receipt?.lastSuccessAt ?? null,
        state: Object.values(workers).some((w) => w.status === "disabled")
          ? ("disabled" as const)
          : Object.values(workers).some((w) =>
                ["failed", "partial", "unknown"].includes(w.status),
              )
            ? ("attention_required" as const)
            : Object.values(workers).every((w) => w.status === "completed")
              ? ("working" as const)
              : ("configured_unverified" as const),
      },
    };
    return json({
      mode: studio.error ? "demo" : "live",
      ...Object.fromEntries(
        Object.entries(integrations).map(([k, v]) => [
          k,
          v.state === "working",
        ]),
      ),
      integrations,
      workers,
      issues: Object.values(integrations).some(
        (v) => v.state === "attention_required",
      )
        ? [
            "Saved integration work needs attention. See delivery and synchronization history.",
          ]
        : [],
      release: releaseMetadata(),
      correlationId: id,
    });
  } catch (e) {
    return apiError(e, id);
  }
};
export const config: Config = { path: "/api/v2/health" };
