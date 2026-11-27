import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "./http";
import { calendarOAuthStudio } from "./calendar-oauth";
import { workerEnabled } from "./worker-controls";

export const gmailOAuthPath = "/api/v2/gmail/oauth/callback";
const gmailScope = "https://www.googleapis.com/auth/gmail.send";
const browserCookie = "__Host-coachd-gmail-oauth";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
const opaque = () => randomBytes(32).toString("base64url");
const env = (name: string) => globalThis.Netlify?.env.get(name);

export function legacyGoogleCredential() {
  return {
    clientId: env("GOOGLE_CLIENT_ID") || env("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret:
      env("GOOGLE_CLIENT_SECRET") || env("GOOGLE_OAUTH_CLIENT_SECRET"),
    refreshToken: env("GOOGLE_REFRESH_TOKEN"),
  };
}

export function legacyGmailConfigured() {
  const { clientId, clientSecret, refreshToken } = legacyGoogleCredential();
  return Boolean(clientId && clientSecret && refreshToken);
}

export function gmailOAuthConfig() {
  const configuredRedirect = env("GOOGLE_GMAIL_OAUTH_REDIRECT_URI");
  if (!configuredRedirect) return null;
  const redirect = URL.parse(configuredRedirect);
  const clientId = env("GOOGLE_GMAIL_OAUTH_CLIENT_ID");
  const clientSecret = env("GOOGLE_GMAIL_OAUTH_CLIENT_SECRET");
  const account = env("GOOGLE_GMAIL_ACCOUNT_EMAIL")?.trim().toLowerCase();
  const local =
    redirect?.protocol === "http:" &&
    redirect.hostname === "localhost" &&
    ["dev", "local"].includes(env("CONTEXT") ?? "") &&
    ["localhost", "127.0.0.1"].includes(
      URL.parse(env("SUPABASE_URL") ?? "")?.hostname ?? "",
    );
  if (
    !redirect ||
    (redirect.protocol !== "https:" && !local) ||
    redirect.pathname !== gmailOAuthPath ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    !clientId ||
    !clientSecret ||
    [env("GOOGLE_CLIENT_ID"), env("GOOGLE_OAUTH_CLIENT_ID")].includes(
      clientId,
    ) ||
    !account
  )
    return null;
  return { redirect, clientId, clientSecret, account };
}

export async function gmailGrantStatus(
  db: SupabaseClient,
  studio: string,
  client?: string,
) {
  const { data, error } = await db
    .rpc("gmail_delivery_oauth_status", {
      p_studio: studio,
      p_client: client ?? null,
    })
    .abortSignal(AbortSignal.timeout(3000));
  if (error) throw new Error("Gmail authorization could not be verified.");
  return data as {
    account: string;
    authorizedAt: string;
    clientMatches: boolean;
  } | null;
}

export async function gmailConnection(
  db: SupabaseClient,
  studio: string,
  origin: string,
) {
  const config = gmailOAuthConfig();
  const grant = await gmailGrantStatus(db, studio, config?.clientId);
  const deliveryHeld = !workerEnabled("automations");
  const availableHere = config?.redirect.origin === origin;
  return {
    authorization: grant
      ? grant.clientMatches && config?.account === grant.account
        ? ("managed" as const)
        : ("configuration" as const)
      : legacyGmailConfigured()
        ? ("legacy" as const)
        : ("configuration" as const),
    account: grant?.account ?? config?.account ?? null,
    authorizedAt: grant?.authorizedAt ?? null,
    availableHere,
    canReauthorize: availableHere && deliveryHeld,
    deliveryHeld,
  };
}

function cookie(value: string, maxAge: number) {
  return `${browserCookie}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export async function beginGmailOAuth(
  request: Request,
  db: SupabaseClient,
  studio: string,
  actor: string,
) {
  const config = gmailOAuthConfig();
  if (!config || config.redirect.origin !== new URL(request.url).origin)
    throw new AppError("PROVIDER_UNAVAILABLE", {
      status: 409,
      message:
        "The Gmail OAuth callback must be configured for this deployment.",
    });
  if (studio !== (await calendarOAuthStudio(db))) throw AppError.forbidden();
  if (workerEnabled("automations"))
    throw new AppError("PROVIDER_UNAVAILABLE", {
      status: 409,
      message: "Pause email delivery before reconnecting Gmail.",
    });
  const state = opaque(),
    browser = opaque(),
    verifier = opaque();
  const { error } = await db.rpc("begin_gmail_delivery_oauth", {
    p_studio: studio,
    p_actor: actor,
    p_state: digest(state),
    p_browser: digest(browser),
    p_verifier: verifier,
  });
  if (error) throw new Error("Gmail authorization could not start.");
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirect.href,
    response_type: "code",
    scope: `openid email ${gmailScope}`,
    access_type: "offline",
    prompt: "consent",
    login_hint: config.account,
    state,
    code_challenge: digest(verifier),
    code_challenge_method: "S256",
  }).toString();
  return Response.json(
    { authorize: authorize.href },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": cookie(browser, 600),
      },
    },
  );
}

export async function completeGmailOAuth(request: Request, db: SupabaseClient) {
  const config = gmailOAuthConfig();
  const url = new URL(request.url);
  if (
    !config ||
    url.origin !== config.redirect.origin ||
    request.method !== "GET"
  )
    return new Response(null, { status: 404 });
  const finish = (result: string) => {
    const settings = new URL(
      "/coach/settings?panel=integrations&service=email",
      config.redirect,
    );
    settings.searchParams.set("gmail_auth", result);
    return new Response(null, {
      status: 303,
      headers: {
        Location: settings.href,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Set-Cookie": cookie("", 0),
      },
    });
  };
  const state = url.searchParams.get("state") ?? "";
  const browser =
    request.headers
      .get("cookie")
      ?.split("; ")
      .find((value) => value.startsWith(browserCookie + "="))
      ?.slice(browserCookie.length + 1) ?? "";
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    !/^[A-Za-z0-9_-]{43}$/.test(browser)
  )
    return finish("invalid");
  const consumed = await db.rpc("consume_gmail_delivery_oauth", {
    p_state: digest(state),
    p_browser: digest(browser),
  });
  const pending = consumed.data as {
    studio_id: string;
    actor_id: string;
    verifier: string;
  } | null;
  if (
    consumed.error ||
    !pending ||
    pending.studio_id !== (await calendarOAuthStudio(db))
  )
    return finish("invalid");
  if (url.searchParams.has("error")) return finish("declined");
  if (workerEnabled("automations")) return finish("delivery_active");
  const code = url.searchParams.get("code");
  if (!code || code.length > 4096) return finish("invalid");
  const signal = AbortSignal.timeout(6500);
  try {
    const exchange = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal,
      redirect: "error",
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirect.href,
        grant_type: "authorization_code",
        code_verifier: pending.verifier,
      }),
    });
    const token = (await exchange.json()) as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
    };
    if (
      !exchange.ok ||
      !token.access_token ||
      !token.refresh_token ||
      !token.scope?.split(" ").includes(gmailScope)
    )
      return finish("permissions");
    const account = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: { Authorization: "Bearer " + token.access_token },
        signal,
        redirect: "error",
      },
    );
    if (!account.ok) return finish("permissions");
    const identity = (await account.json()) as {
      email?: string;
      email_verified?: boolean;
    };
    if (
      !identity.email_verified ||
      identity.email?.toLowerCase() !== config.account
    )
      return finish("account");
    if (workerEnabled("automations")) return finish("delivery_active");
    const stored = await db.rpc("save_gmail_delivery_oauth", {
      p_studio: pending.studio_id,
      p_actor: pending.actor_id,
      p_email: config.account,
      p_client: config.clientId,
      p_refresh: token.refresh_token,
    });
    return finish(stored.error ? "unavailable" : "connected");
  } catch {
    return finish("unavailable");
  }
}
