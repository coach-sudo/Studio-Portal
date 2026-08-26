import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { apiError, correlationId, json } from "./_shared/http";
import { serviceClient, userClient } from "./_shared/supabase";

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
    if (context.params.action === "password-changed" && request.method === "POST") {
      const db = userClient(request);
      const { data: authData, error: authError } = await db.auth.getUser();
      if (authError || !authData.user) throw new Error("FORBIDDEN");
      const { error } = await serviceClient()
        .from("portal_accounts")
        .update({ must_change_password: false, updated_at: new Date().toISOString() })
        .eq("user_id", authData.user.id);
      if (error) throw error;
      return json({ ok: true });
    }
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
    const { data: account, error: accountError } = await service
      .from("portal_accounts")
      .select("id,email,account_type,must_change_password,students!inner(portal_enabled)")
      .ilike("username", username)
      .eq("students.portal_enabled", true)
      .maybeSingle();
    if (accountError || !account) throw new Error("FORBIDDEN");
    const email = String(account.email).trim().toLowerCase();
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
      accountType: account.account_type,
      mustChangePassword: account.must_change_password,
      destination: account.must_change_password ? "/change-password" : "/portal",
    });
  } catch (error) {
    return apiError(error, id);
  }
};

export const config: Config = { path: "/api/v2/auth/:action" };
