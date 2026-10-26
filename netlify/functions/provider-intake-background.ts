import type { Config, Context } from "@netlify/functions";
import { runScheduledWorker } from "./_shared/scheduled-worker";
import { runProviderIntake } from "./_shared/provider-intake";

export default async (request: Request, context: Context) => {
  await runScheduledWorker(
    "provider-intake",
    request,
    context,
    async (telemetry) => {
      await runProviderIntake(telemetry);
    },
  );
};

export const config: Config = { background: true };
