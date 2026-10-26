import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";
import { serviceClient } from "./supabase";
import { workerTelemetry, type WorkerTelemetry } from "./worker-telemetry";

export type ScheduledWorker = "provider-intake" | "booking-maintenance";
function signature(body: string) {
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("Worker configuration is unavailable.");
  // Domain separation: the service key itself never leaves this process.
  return createHmac("sha256", key)
    .update("coachd-scheduled-worker-v1\n" + body)
    .digest("hex");
}

export async function dispatchScheduledWorker(
  worker: ScheduledWorker,
  context: Context,
) {
  const telemetry = workerTelemetry(worker, context.requestId);
  try {
    telemetry.stage("dispatch");
    if (
      !/^[a-z0-9-]+$/.test(context.site.name || "") ||
      !/^[a-f0-9]{24}$/.test(context.deploy.id)
    )
      throw new Error("Worker configuration is unavailable.");
    const db = serviceClient();
    const job = await db
      .rpc("enqueue_scheduled_worker", { p_worker: worker })
      .abortSignal(AbortSignal.timeout(5000));
    if (job.error) throw job.error;
    if (!job.data) {
      telemetry.success();
      return Response.json({ ok: true, status: "already_running" });
    }
    const body = JSON.stringify({
      worker,
      jobId: job.data,
      deployId: context.deploy.id,
    });
    // Pin dispatch to the invoking artifact; never follow a redirect to another host.
    const response = await fetch(
      `https://${context.deploy.id}--${context.site.name}.netlify.app/.netlify/functions/${worker}-background`,
      {
        method: "POST",
        body,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: {
          "content-type": "application/json",
          "x-worker-signature": signature(body),
        },
      },
    );
    if (response.status !== 202)
      throw new Error(
        "PROVIDER_UNAVAILABLE: Background dispatch was not accepted.",
      );
    telemetry.success();
    return Response.json(
      { ok: true, status: "accepted", jobId: job.data },
      { status: 202 },
    );
  } catch (error) {
    const safe = telemetry.failure(error);
    // Pending receipt survives failed/ambiguous delivery; the next schedule retries it.
    throw new Error(safe.message);
  }
}

export async function runScheduledWorker(
  worker: ScheduledWorker,
  request: Request,
  context: Context,
  process: (telemetry: WorkerTelemetry) => Promise<unknown>,
) {
  const telemetry = workerTelemetry(worker, context.requestId);
  let token: string | undefined, jobId: string | undefined;
  try {
    telemetry.stage("authorization");
    const body = await request.text(),
      supplied = request.headers.get("x-worker-signature") || "";
    const expected = signature(body);
    if (
      request.method !== "POST" ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    )
      throw new Error("Worker authorization failed.");
    const input = JSON.parse(body);
    if (
      input.worker !== worker ||
      input.deployId !== context.deploy.id ||
      !/^[a-f0-9-]{36}$/.test(input.jobId)
    )
      throw new Error("Worker authorization failed.");
    jobId = input.jobId;
    telemetry.stage("claim");
    const db = serviceClient();
    const claim = await db.rpc("claim_scheduled_worker", {
      p_worker: worker,
      p_job: jobId,
    });
    if (claim.error) throw claim.error;
    if (!claim.data) {
      telemetry.success();
      return;
    }
    token = claim.data;
    await process(telemetry);
    telemetry.stage("completion");
    const finish = await db.rpc("finish_scheduled_worker", {
      p_worker: worker,
      p_job: jobId,
      p_token: token,
    });
    if (finish.error) throw finish.error;
    if (!finish.data) throw new Error("Worker completion claim expired.");
    telemetry.success();
  } catch (error) {
    const safe = telemetry.failure(error);
    if (token) {
      try {
        const db = serviceClient();
        const finish = await db.rpc("finish_scheduled_worker", {
          p_worker: worker,
          p_job: jobId,
          p_token: token,
          p_error: safe.category,
        });
        if (finish.error || !finish.data)
          telemetry.failure(new Error("Worker receipt unavailable."));
      } catch {
        telemetry.failure(new Error("Worker receipt unavailable."));
      }
    }
    // Reject, rather than returning an error Response: Netlify background retries
    // only see handler errors. Lost completion replies remain fenced/recoverable.
    throw new Error(safe.message);
  }
}
