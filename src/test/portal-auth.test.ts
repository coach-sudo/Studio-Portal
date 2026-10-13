import type { Context } from "@netlify/functions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../netlify/functions/portal-auth";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("../../netlify/functions/_shared/supabase", () => ({
  serviceClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
  userClient: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithPassword: mocks.signIn } }),
}));
const user = {
  id: "test-user",
  email: "coach@example.com",
  email_confirmed_at: "2026-10-13",
};
function login(username: string) {
  return handler(
    new Request("https://studio.test/api/v2/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "private passphrase" }),
    }),
    {
      requestId: "test-request",
      params: { action: "login" },
    } as unknown as Context,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("Netlify", {
    env: {
      get: (key: string) =>
        key === "SUPABASE_URL"
          ? "https://studio.supabase.co"
          : "public-test-key",
    },
  });
  mocks.rpc.mockImplementation((name: string) =>
    Promise.resolve({
      data:
        name === "claim_public_rate_limit"
          ? true
          : { role: "coach", destination: "/coach" },
      error: null,
    }),
  );
  mocks.signIn.mockResolvedValue({
    data: {
      user,
      session: { access_token: "access", refresh_token: "refresh" },
    },
    error: null,
  });
  mocks.from.mockReturnValue({
    select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
  });
});
describe("email password authentication", () => {
  it("authenticates an email and derives coach access from the verified identity", async () => {
    const response = await login(" Coach@Example.com ");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      destination: "/coach",
      accessToken: "access",
      mustChangePassword: false,
    });
    expect(mocks.signIn).toHaveBeenCalledWith({
      email: "coach@example.com",
      password: "private passphrase",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_portal_access_by_verified_email",
      { target_user: user.id, target_email: user.email },
    );
  });
  it("does not return credentials for an account without studio access", async () => {
    mocks.rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "claim_public_rate_limit"
          ? { data: true, error: null }
          : { data: null, error: new Error("FORBIDDEN") },
      ),
    );
    const response = await login("uninvited@example.com");
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("accessToken");
  });
  it("rejects an unverified email before claiming access", async () => {
    mocks.signIn.mockResolvedValue({
      data: {
        user: { ...user, email_confirmed_at: null },
        session: { access_token: "access" },
      },
      error: null,
    });
    const response = await login("coach@example.com");
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "claim_portal_access_by_verified_email",
      expect.anything(),
    );
  });
  it("enforces temporary password changes for email login", async () => {
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: [{ must_change_password: true }],
            error: null,
          }),
      }),
    });
    const response = await login("student@example.com");
    expect(await response.json()).toMatchObject({
      destination: "/change-password",
      mustChangePassword: true,
    });
  });
  it("rate limits email login before checking a password", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const response = await login("coach@example.com");
    expect(response.status).toBe(429);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it("keeps existing username login working", async () => {
    const chain: Record<string, unknown> = {};
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        email: "student@example.com",
        account_type: "student",
        must_change_password: false,
      },
      error: null,
    });
    mocks.from.mockReturnValue({ select: () => chain });
    const response = await login("student.name");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ destination: "/portal" });
    expect(mocks.signIn).toHaveBeenCalledWith({
      email: "student@example.com",
      password: "private passphrase",
    });
  });
});
