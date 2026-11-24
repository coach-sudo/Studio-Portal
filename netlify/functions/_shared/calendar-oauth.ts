import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "./http";

export const calendarOAuthPath = "/api/v2/calendar/oauth/callback";
const calendarScope = "https://www.googleapis.com/auth/calendar";
const browserCookie = "__Host-coachd-calendar-oauth";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
const opaque = () => randomBytes(32).toString("base64url");
const env = (name: string) => globalThis.Netlify?.env.get(name);

export function calendarOAuthConfig() {
  const configuredRedirect = env("GOOGLE_CALENDAR_OAUTH_REDIRECT_URI");
  if (!configuredRedirect) return null;
  const redirect = URL.parse(configuredRedirect);
  const clientId = env("GOOGLE_CLIENT_ID") || env("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret =
    env("GOOGLE_CLIENT_SECRET") || env("GOOGLE_OAUTH_CLIENT_SECRET");
  const account = env("GOOGLE_ACCOUNT_EMAIL")?.trim().toLowerCase();
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
    redirect.pathname !== calendarOAuthPath ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    !clientId ||
    !clientSecret ||
    !account
  )
    return null;
  return { redirect, clientId, clientSecret, account };
}

export async function calendarOAuthStudio(db: SupabaseClient) {
  const configured = env("STUDIO_ID");
  if (configured) return configured;
  const { data, error } = await db
    .from("studios")
    .select("id")
    .eq("slug", env("STUDIO_SLUG") || "stage-story")
    .maybeSingle();
  if (error) throw new Error("Calendar studio could not be verified.");
  return data?.id as string | undefined;
}

function cookie(value: string, maxAge: number) {
  return `${browserCookie}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export async function beginCalendarOAuth(
  request: Request,
  db: SupabaseClient,
  studio: string,
  actor: string,
) {
  const config = calendarOAuthConfig();
  if (!config || config.redirect.origin !== new URL(request.url).origin)
    throw new AppError("PROVIDER_UNAVAILABLE", {
      status: 409,
      message:
        "The Calendar OAuth callback must be configured for this deployment.",
    });
  if (studio !== (await calendarOAuthStudio(db))) throw AppError.forbidden();
  const state = opaque(),
    browser = opaque(),
    verifier = opaque();
  const { error } = await db.rpc("begin_calendar_oauth", {
    p_studio: studio,
    p_actor: actor,
    p_state: digest(state),
    p_browser: digest(browser),
    p_verifier: verifier,
  });
  if (error) throw new Error("Calendar authorization could not start.");
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirect.href,
    response_type: "code",
    scope: calendarScope,
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

export async function completeCalendarOAuth(
  request: Request,
  db: SupabaseClient,
) {
  const config = calendarOAuthConfig();
  const url = new URL(request.url);
  if (
    !config ||
    url.origin !== config.redirect.origin ||
    request.method !== "GET"
  )
    return new Response(null, { status: 404 });
  const finish = (result: string) => {
    const settings = new URL(
      "/coach/settings?panel=integrations&service=calendar",
      config.redirect,
    );
    settings.searchParams.set("calendar_auth", result);
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
  const consumed = await db.rpc("consume_calendar_oauth", {
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
      !token.scope?.split(" ").includes(calendarScope)
    )
      return finish("permissions");
    const lookup = async (id: string) => {
      const response = await fetch(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList/" +
          encodeURIComponent(id) +
          "?fields=id,primary,accessRole",
        {
          headers: { Authorization: "Bearer " + token.access_token },
          signal,
          redirect: "error",
        },
      );
      return response.ok
        ? ((await response.json()) as {
            id?: string;
            primary?: boolean;
            accessRole?: string;
          })
        : null;
    };
    const [identity, target] = await Promise.all([
      lookup("primary"),
      lookup(env("GOOGLE_CALENDAR_ID") || "primary"),
    ]);
    if (!identity?.primary || identity.id?.toLowerCase() !== config.account)
      return finish("account");
    if (!target?.id || !["owner", "writer"].includes(target.accessRole ?? ""))
      return finish("permissions");
    const stored = await db.rpc("save_calendar_oauth", {
      p_studio: pending.studio_id,
      p_actor: pending.actor_id,
      p_email: config.account,
      p_refresh: token.refresh_token,
    });
    return finish(stored.error ? "unavailable" : "connected");
  } catch {
    return finish("unavailable");
  }
}
