import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  beginGmailOAuth,
  completeGmailOAuth,
  gmailConnection,
} from "./gmail-oauth";
import { googleAccessToken } from "./google";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./supabase", () => ({ serviceClient: () => mocks }));

const origin = "https://staging.example.test";
const callback = origin + "/api/v2/gmail/oauth/callback";
const studio = "fixture-studio";
const actor = "fixture-actor";
const account = "sender@example.test";
const scope = "https://www.googleapis.com/auth/gmail.send";
const db = mocks as unknown as SupabaseClient;
let values: Record<string, string>;
const provider = vi.fn();

beforeEach(() => {
  mocks.rpc.mockReset();
  provider.mockReset();
  values = {
    STUDIO_ID: studio,
    WORKER_AUTOMATIONS_ENABLED: "false",
    GOOGLE_GMAIL_OAUTH_REDIRECT_URI: callback,
    GOOGLE_GMAIL_OAUTH_CLIENT_ID: "fixture-gmail-client",
    GOOGLE_GMAIL_OAUTH_CLIENT_SECRET: "fixture-gmail-secret",
    GOOGLE_GMAIL_ACCOUNT_EMAIL: account,
    GOOGLE_CLIENT_ID: "fixture-existing-client",
    GOOGLE_CLIENT_SECRET: "fixture-existing-secret",
    GOOGLE_REFRESH_TOKEN: "fixture-existing-grant",
  };
  vi.stubGlobal("Netlify", { env: { get: (name: string) => values[name] } });
  vi.stubGlobal("fetch", provider);
});

afterEach(() => vi.unstubAllGlobals());

const start = () => beginGmailOAuth(new Request(origin), db, studio, actor);
const read = (data: unknown, error: unknown = null) => ({
  abortSignal: async () => ({ data, error }),
});

async function consent(connectedAccount = account, grantedScope = scope) {
  mocks.rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({
    data: { studio_id: studio, actor_id: actor, verifier: "fixture-verifier" },
  });
  provider
    .mockResolvedValueOnce(
      Response.json({
        access_token: "fixture-access",
        refresh_token: "fixture-new-grant",
        scope: grantedScope,
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ email: connectedAccount, email_verified: true }),
    );
  const step = await start();
  const authorize = new URL((await step.json()).authorize);
  expect(authorize.origin).toBe("https://accounts.google.com");
  expect(authorize.searchParams.get("scope")).toBe("openid email " + scope);
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize.searchParams.get("client_id")).toBe(
    values.GOOGLE_GMAIL_OAUTH_CLIENT_ID,
  );
  const cookie = step.headers.get("Set-Cookie")!;
  expect(cookie).toContain("__Host-coachd-gmail-oauth=");
  expect(cookie).toContain("HttpOnly; Secure; SameSite=Lax");
  return new Request(
    callback +
      "?state=" +
      authorize.searchParams.get("state") +
      "&code=fixture-code",
    {
      headers: { Cookie: cookie.split(";")[0] },
    },
  );
}

it("stores a dedicated verified Gmail grant while delivery stays held", async () => {
  const request = await consent();
  mocks.rpc
    .mockResolvedValueOnce({ error: null })
    .mockResolvedValueOnce({ data: null });
  const response = await completeGmailOAuth(request, db);
  expect(response.headers.get("Location")).toContain(
    "service=email&gmail_auth=connected",
  );
  expect(response.headers.get("Location")).not.toContain("fixture-new-grant");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
    "begin_gmail_delivery_oauth",
    "consume_gmail_delivery_oauth",
    "save_gmail_delivery_oauth",
  ]);
  expect(mocks.rpc).toHaveBeenLastCalledWith("save_gmail_delivery_oauth", {
    p_actor: actor,
    p_studio: studio,
    p_email: account,
    p_client: values.GOOGLE_GMAIL_OAUTH_CLIENT_ID,
    p_refresh: "fixture-new-grant",
  });
  expect(provider.mock.calls.map(([url]) => url)).toEqual([
    "https://oauth2.googleapis.com/token",
    "https://openidconnect.googleapis.com/v1/userinfo",
  ]);
  expect(
    (await completeGmailOAuth(request, db)).headers.get("Location"),
  ).toContain("gmail_auth=invalid");
  expect(provider).toHaveBeenCalledTimes(2);
});

it.each([
  ["wrong@example.test", scope, "account"],
  [account, "email openid", "permissions"],
])(
  "preserves the prior grant when consent is ineligible (%s, %s)",
  async (email, grant, outcome) => {
    const request = await consent(email, grant);
    expect(
      (await completeGmailOAuth(request, db)).headers.get("Location"),
    ).toContain("gmail_auth=" + outcome);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  },
);

it("refuses to authorize when delivery could run, including when enabled during consent", async () => {
  values.WORKER_AUTOMATIONS_ENABLED = "true";
  await expect(start()).rejects.toThrow();
  expect(mocks.rpc).not.toHaveBeenCalled();
  values.WORKER_AUTOMATIONS_ENABLED = "false";
  const request = await consent();
  values.WORKER_AUTOMATIONS_ENABLED = "true";
  expect(
    (await completeGmailOAuth(request, db)).headers.get("Location"),
  ).toContain("gmail_auth=delivery_active");
  expect(provider).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
});

it("requires the canonical portal and a Gmail OAuth client independent of Calendar", async () => {
  await expect(
    beginGmailOAuth(
      new Request("https://other.example.test"),
      db,
      studio,
      actor,
    ),
  ).rejects.toThrow();
  values.GOOGLE_GMAIL_OAUTH_CLIENT_ID = values.GOOGLE_CLIENT_ID;
  await expect(start()).rejects.toThrow();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("reports the verified sender separately from the hold without exposing tokens", async () => {
  mocks.rpc.mockReturnValue(
    read({
      account,
      authorizedAt: "2026-11-26T20:00:00Z",
      clientMatches: true,
    }),
  );
  expect(await gmailConnection(db, studio, origin)).toEqual({
    account,
    authorizedAt: "2026-11-26T20:00:00Z",
    authorization: "managed",
    availableHere: true,
    deliveryHeld: true,
    canReauthorize: true,
  });
});

it("uses the new grant only for the authorized studio delivery lane", async () => {
  mocks.rpc
    .mockReturnValueOnce(read({ account, clientMatches: true }))
    .mockReturnValueOnce(read("fixture-new-grant"));
  provider.mockImplementation(async () =>
    Response.json({ access_token: "fixture-access" }),
  );
  for (const lane of [
    { gmailDeliveryStudio: studio },
    "gmail",
    "calendar",
    { gmailDeliveryStudio: "another-studio" },
  ] as const) {
    await expect(googleAccessToken(undefined, lane)).resolves.toBe(
      "fixture-access",
    );
  }
  const refreshes = provider.mock.calls.map(([, request]) => [
    request.body.get("client_id"),
    request.body.get("refresh_token"),
  ]);
  expect(refreshes).toEqual([
    ["fixture-gmail-client", "fixture-new-grant"],
    ...Array(3).fill(["fixture-existing-client", "fixture-existing-grant"]),
  ]);
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
});

it("fails closed when the stored Gmail connection cannot be read or belongs to another client", async () => {
  mocks.rpc
    .mockReturnValueOnce(read(null, { code: "fixture-error" }))
    .mockReturnValueOnce(read({ account, clientMatches: false }));
  const delivery = { gmailDeliveryStudio: studio };
  await expect(googleAccessToken(undefined, delivery)).rejects.toThrow();
  await expect(googleAccessToken(undefined, delivery)).rejects.toMatchObject({
    reason: "configuration",
  });
  expect(provider).not.toHaveBeenCalled();
});
