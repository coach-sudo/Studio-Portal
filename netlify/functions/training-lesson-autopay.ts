import type { Config, Context } from "@netlify/functions";
import { runLessonAutopay, trainingStripe } from "./_shared/training-autopay";

export default async (_request: Request, context: Context) => {
  if (Netlify.env.get("TRAINING_AUTOPAY_WORKER") !== "true")
    return Response.json({ status: "disabled" });
  const provider = trainingStripe(context);
  if (!provider) return Response.json({ status: "disabled" });
  const result = await runLessonAutopay(provider.stripe, provider.live);
  return Response.json({
    status: provider.live ? "live-mode" : "test-mode",
    ...result,
  });
};

export const config: Config = { schedule: "*/2 * * * *" };
