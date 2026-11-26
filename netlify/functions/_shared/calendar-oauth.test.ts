import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import { beginCalendarOAuth, completeCalendarOAuth } from "./calendar-oauth";

const origin = "https://staging.example.test";
const callback = origin + "/api/v2/calendar/oauth/callback";
const studio = "fixture-studio";
const actor = "fixture-actor";

afterEach(() => vi.unstubAllGlobals());

async function flow(connectedEmail: string) {
  const values: Record<string, string> = {
    STUDIO_ID: studio,
    GOOGLE_CALENDAR_OAUTH_REDIRECT_URI: callback,
    GOOGLE_CLIENT_ID: "fixture-client",
    GOOGLE_CLIENT_SECRET: "fixture-confidential",
    GOOGLE_ACCOUNT_EMAIL: "studio@example.test",
  };
  vi.stubGlobal("Netlify", { env: { get: (name: string) => values[name] } });
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({
      data: {
        studio_id: studio,
        actor_id: actor,
        verifier: "fixture-verifier",
      },
      error: null,
    })
    .mockResolvedValueOnce({ data: null, error: null });
  const db = { rpc } as unknown as SupabaseClient;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        access_token: "fixture-access",
        refresh_token: "fixture-refresh",
        scope: "https://www.googleapis.com/auth/calendar",
      }),
    )
    .mockImplementation(() =>
      Promise.resolve(
        Response.json({
          id: connectedEmail,
          primary: true,
          accessRole: "owner",
        }),
      ),
    );
  vi.stubGlobal("fetch", fetcher);

  const step = await beginCalendarOAuth(
    new Request(origin + "/api/v2/studio-health/calendar-oauth"),
    db,
    studio,
    actor,
  );
  const cookie = step.headers.get("Set-Cookie")!;
  const authorize = new URL((await step.json()).authorize);
  const state = authorize.searchParams.get("state");
  expect(authorize.origin).toBe("https://accounts.google.com");
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(cookie).toContain("HttpOnly; Secure; SameSite=Lax");
  expect(authorize.href).not.toContain("fixture-confidential");
  const request = new Request(
    callback + "?state=" + state + "&code=fixture-code",
    { headers: { Cookie: cookie.split(";")[0] } },
  );
  const result = await completeCalendarOAuth(request, db);
  return { rpc, result, fetcher };
}

it("pins the account and only stores the verified Calendar grant server-side", async () => {
  const { rpc, result, fetcher } = await flow("studio@example.test");
  expect(result.headers.get("Location")).toContain("calendar_auth=connected");
  expect(result.headers.get("Location")).not.toContain("fixture-refresh");
  expect(rpc).toHaveBeenNthCalledWith(3, "save_calendar_oauth", {
    p_studio: studio,
    p_actor: actor,
    p_email: "studio@example.test",
    p_refresh: "fixture-refresh",
  });
  expect(
    new URLSearchParams(fetcher.mock.calls[0][1].body).get("code_verifier"),
  ).toBe("fixture-verifier");
});

it("preserves the stored grant when consent used a different Google account", async () => {
  const { rpc, result } = await flow("other@example.test");
  expect(result.headers.get("Location")).toContain("calendar_auth=account");
  expect(rpc).toHaveBeenCalledTimes(2);
});
