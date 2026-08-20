import type { Config, Context } from "@netlify/functions";
import { apiError, correlationId, json } from "./_shared/http";
import { userClient } from "./_shared/supabase";
import { runProviderIntake } from "./provider-intake";

export default async (request: Request, context: Context) => {
  const id = correlationId(request, context.requestId);
  try {
    if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED", message: "Method not allowed.", retryable: false, correlationId: id }, 405);
    const { data, error } = await userClient(request).from("memberships").select("id").eq("role", "coach").limit(1).single();
    if (error || !data) throw new Error("FORBIDDEN");
    await runProviderIntake();
    return json({ ok: true, correlationId: id });
  } catch (error) { return apiError(error, id); }
};

export const config: Config = { path: "/api/v2/admin/provider-intake" };
