import {
  workerEnabled,
  disabledWorkerResponse,
} from "./_shared/worker-controls";
import type { Config } from "@netlify/functions";
import { googleAccessToken } from "./_shared/google";
import { serviceClient } from "./_shared/supabase";
import { projectCalendarItem } from "./_shared/calendar-projection";

export default async () => {
  if (!workerEnabled("calendar")) return disabledWorkerResponse("calendar");
  const db = serviceClient();
  const { data: items, error } = await db.rpc("claim_calendar_projections", {
    batch_size: 10,
  });
  if (error) throw error;
  if (!items?.length) return Response.json({ ok: true, processed: 0 });
  let projected = 0;
  for (const item of items) {
    if (!workerEnabled("calendar")) break;
    if (
      await projectCalendarItem(
        db,
        item,
        googleAccessToken,
        Netlify.env.get("GOOGLE_CALENDAR_ID") || "primary",
      )
    )
      projected++;
  }
  return Response.json({
    ok: true,
    processed: items.length,
    projected,
    pending: items.length - projected,
  });
};
export const config: Config = { schedule: "*/5 * * * *" };
