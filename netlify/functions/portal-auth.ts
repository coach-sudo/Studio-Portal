import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { apiError, correlationId, json } from "./_shared/http";
import { portalLoginSchema } from "./_shared/schemas";
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
    if (context.params.action === "claim-access" && request.method === "POST") {
      const db = userClient(request);
      const { data: authData, error: authError } = await db.auth.getUser();
      const user = authData.user;
      if (authError || !user?.id || !user.email || !user.email_confirmed_at)
        throw new Error("FORBIDDEN:VERIFIED_EMAIL_REQUIRED");
      const { data, error } = await serviceClient().rpc(
        "claim_portal_access_by_verified_email",
        { target_user: user.id, target_email: user.email },
      );
      if (error) throw error;
      return json(data);
    }
    if (
      context.params.action === "password-changed" &&
      request.method === "POST"
    ) {
      const db = userClient(request);
      const { data: authData, error: authError } = await db.auth.getUser();
      if (authError || !authData.user) throw new Error("FORBIDDEN");
      const { error } = await serviceClient()
        .from("portal_accounts")
        .update({
          must_change_password: false,
          updated_at: new Date().toISOString(),
        })
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
    const body = portalLoginSchema.parse(await request.json());
    const username = body.username.toLowerCase();
    const password = body.password;
    const service = serviceClient();
    const isEmail = username.includes("@");
    const { data: account, error: accountError } = isEmail
      ? { data: null, error: null }
      : await service
          .from("portal_accounts")
          .select(
            "id,email,account_type,must_change_password,students!inner(portal_enabled)",
          )
          .eq("username", username)
          .eq("students.portal_enabled", true)
          .maybeSingle();
    if (accountError || (!isEmail && !account)) throw new Error("FORBIDDEN");
    const email = isEmail
      ? username
      : String(account!.email).trim().toLowerCase();
    const url = Netlify.env.get("SUPABASE_URL");
    const key = Netlify.env.get("SUPABASE_ANON_KEY");
    if (!url || !key) throw new Error("Supabase is not configured.");
    const auth = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await auth.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.session) throw new Error("FORBIDDEN");
    let destination = "/portal";
    let mustChangePassword = Boolean(account?.must_change_password);
    if (isEmail) {
      if (!data.user?.email_confirmed_at || !data.user.email)
        throw new Error("FORBIDDEN");
      const { data: access, error: accessError } = await service.rpc(
        "claim_portal_access_by_verified_email",
        { target_user: data.user.id, target_email: data.user.email },
      );
      if (accessError || !access) throw new Error("FORBIDDEN");
      destination = (access as { destination: string }).destination;
      const { data: accounts, error: accountsError } = await service
        .from("portal_accounts")
        .select("must_change_password")
        .eq("user_id", data.user.id);
      if (accountsError) throw accountsError;
      mustChangePassword =
        accounts?.some((entry) => entry.must_change_password) ?? false;
    }
    return json({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
      accountType: account?.account_type,
      mustChangePassword,
      destination: mustChangePassword ? "/change-password" : destination,
    });
  } catch (error) {
    return apiError(error, id);
  }
};

export const config: Config = { path: "/api/v2/auth/:action" };
