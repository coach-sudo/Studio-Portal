import type { Config } from "@netlify/functions";
import { dispatchOutbox } from "./_shared/outbox-dispatch";
import { evaluateStudioAutomations } from "./_shared/automation-engine";
import { serviceClient } from "./_shared/supabase";
export default async () => {
  const db = serviceClient(),
    studios = await db.from("studios").select("id");
  if (studios.error) throw studios.error;
  for (const studio of studios.data ?? [])
    await evaluateStudioAutomations(db, studio.id, crypto.randomUUID());
  return Response.json({
    ok: true,
    ...(await dispatchOutbox({ batchSize: 50 })),
  });
};
export const config: Config = { schedule: "*/5 * * * *" };
