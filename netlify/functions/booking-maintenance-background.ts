import type { Config, Context } from "@netlify/functions";
import { runScheduledWorker } from "./_shared/scheduled-worker";
import { runBookingMaintenance } from "./_shared/booking-maintenance";

export default async (request: Request, context: Context) =>
  runScheduledWorker(
    "booking-maintenance",
    request,
    context,
    runBookingMaintenance,
  );
export const config: Config = { background: true };
