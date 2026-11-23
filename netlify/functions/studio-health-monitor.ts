import type { Config } from "@netlify/functions";
import { healthRpc, runStudioHealth } from "./_shared/studio-health";
import { serviceClient } from "./_shared/supabase";

export default async function studioHealthMonitor() {
  const configured = Netlify.env.get("STUDIO_HEALTH_MONITOR_ENABLED");
  const production =
    Netlify.env.get("SITE_ID") === "93829451-dbcf-4863-a07f-fa448cb17494" &&
    Netlify.env.get("CONTEXT") === "production";
  if (configured === undefined ? !production : configured !== "true")
    return Response.json({ status: "disabled" });
  try {
    const db = serviceClient();
    // Bound total work per invocation. The durable per-studio lease also fences manual checks.
    const studios = await healthRpc<string[]>(db, "studio_health_due");
    const batch = studios.slice(0, 3);
    const results = await Promise.allSettled(
      batch.map((studio) => runStudioHealth(db, studio, true)),
    );
    const failed = results.filter(
      (result) => result.status === "rejected",
    ).length;
    if (failed)
      console.error(
        JSON.stringify({ event: "studio_health.monitor_failed", failed }),
      );
    return Response.json(
      { checked: batch.length - failed, failed },
      { status: failed ? 503 : 200 },
    );
  } catch {
    console.error(
      JSON.stringify({ event: "studio_health.monitor_unavailable" }),
    );
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
export const config: Config = { schedule: "*/15 * * * *" };
