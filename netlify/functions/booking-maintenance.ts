import type { Config, Context } from "@netlify/functions";
import { dispatchScheduledWorker } from "./_shared/scheduled-worker";

export default async (_request: Request, context: Context) =>
  dispatchScheduledWorker("booking-maintenance", context);
export const config: Config = { schedule: "*/5 * * * *" };
