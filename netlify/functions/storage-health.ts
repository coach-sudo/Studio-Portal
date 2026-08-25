import type { Config, Context } from "@netlify/functions";
import { apiError, correlationId, json } from "./_shared/http";
import { serviceClient, userClient } from "./_shared/supabase";

export default async (request: Request, context: Context) => {
  const id = correlationId(request, context.requestId);
  try {
    if (request.method !== "GET")
      return json(
        { code: "METHOD_NOT_ALLOWED", message: "Method not allowed.", retryable: false, correlationId: id },
        405,
      );
    const { data: membership, error: membershipError } = await userClient(request)
      .from("memberships")
      .select("studio_id")
      .eq("role", "coach")
      .limit(1)
      .single();
    if (membershipError || !membership) throw new Error("FORBIDDEN");
    const { data, error } = await serviceClient().rpc("studio_storage_health");
    if (error) throw error;
    return json({ ...data, correlationId: id });
  } catch (error) {
    return apiError(error, id);
  }
};

export const config: Config = { path: "/api/v2/storage-health" };
