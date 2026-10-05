import type { Config } from "@netlify/functions";
import { dispatchOutbox } from "./_shared/outbox-dispatch";
import { evaluateStudioAutomations } from "./_shared/automation-engine";
import { serviceClient } from "./_shared/supabase";
export default async () => {
  const db = serviceClient(),
    studios = await db.from("studios").select("id");
  if (studios.error) throw studios.error;
  const deadline = Date.now() + 10_000;
  for (const studio of studios.data ?? []) {
    if (Date.now() >= deadline) break;
    try {
      await evaluateStudioAutomations(
        db,
        studio.id,
        crypto.randomUUID(),
        deadline,
      );
    } catch {
      console.error(
        JSON.stringify({
          event: "automation.evaluation_failed",
          studioId: studio.id,
          code: "AUTOMATION_EVALUATION_FAILED",
        }),
      );
    }
  }
  return Response.json({
    ok: true,
    ...(await dispatchOutbox({ batchSize: 5 })),
  });
};
export const config: Config = { schedule: "*/5 * * * *" };
