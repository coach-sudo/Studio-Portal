import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { apiError, correlationId, json } from "./_shared/http";
import { serviceClient } from "./_shared/supabase";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function rateLimit(request: Request) {
  const address =
    request.headers.get("x-nf-client-connection-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const { data, error } = await serviceClient().rpc("claim_public_rate_limit", {
    target_key: `portal-login:${hash(address)}`,
    target_limit: 10,
    target_window_seconds: 600,
  });
  if (error) throw error;
  if (!data) throw new Error("RATE_LIMITED");
}

export default async (request: Request, context: Context) => {
  const id = correlationId(request, context.requestId);
  try {
    if (context.params.action !== "login" || request.method !== "POST")
      return json(
        {
          code: "NOT_FOUND",
          message: "Unknown authentication endpoint.",
          retryable: false,
          correlationId: id,
        },
        404,
      );
    await rateLimit(request);
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username) || password.length < 8)
      throw new Error("FORBIDDEN");
    const service = serviceClient();
    const { data: student } = await service
      .from("students")
      .select("id,is_minor,email,guardian_email,portal_enabled")
      .ilike("portal_username", username)
      .eq("portal_enabled", true)
      .maybeSingle();
    if (!student) throw new Error("FORBIDDEN");
    const email = String(student.is_minor ? student.guardian_email : student.email)
      .trim()
      .toLowerCase();
    const url = Netlify.env.get("SUPABASE_URL");
    const key = Netlify.env.get("SUPABASE_ANON_KEY");
    if (!url || !key) throw new Error("Supabase is not configured.");
    const auth = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await auth.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new Error("FORBIDDEN");
    return json({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
      destination: "/portal",
    });
  } catch (error) {
    return apiError(error, id);
  }
};

export const config: Config = { path: "/api/v2/auth/:action" };
