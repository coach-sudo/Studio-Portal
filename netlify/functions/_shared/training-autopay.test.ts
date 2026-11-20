import { afterEach, describe, expect, it, vi } from "vitest";
import { autopay, trainingSandbox, trainingStripe } from "./training-autopay";

vi.mock("./release", () => ({
  releaseMetadata: () => ({
    context: Netlify.env.get("TEST_RELEASE_CONTEXT") || "local",
  }),
}));

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./supabase", () => ({ serviceClient: () => ({ rpc }) }));

const local = { site: {}, deploy: {} } as never;
const settings = {
  E2E_EPHEMERAL: "true",
  STAGING_BASE_URL: "http://127.0.0.1:4188",
  TRAINING_AUTOPAY_TEST_MODE: "true",
  STRIPE_SECRET_KEY: ["rk", "test", "fixture"].join("_"),
};

function install(overrides: Record<string, string> = {}) {
  const environment: Record<string, string> = { ...settings, ...overrides };
  vi.stubGlobal("Netlify", { env: { get: (key: string) => environment[key] } });
}

afterEach(() => vi.unstubAllGlobals());

describe("lesson billing environment restrictions", () => {
  it("enables a test key on the disposable loopback candidate", () => {
    install();
    expect(trainingStripe(local)?.origin).toBe(settings.STAGING_BASE_URL);
  });

  it("rejects live keys even when all test flags are set", () => {
    install({ STRIPE_SECRET_KEY: ["sk", "live", "fixture"].join("_") });
    expect(trainingStripe(local)).toBeNull();
  });

  it("rejects missing opt-in and non-loopback ephemeral origins", () => {
    install({ TRAINING_AUTOPAY_TEST_MODE: "false" });
    expect(trainingStripe(local)).toBeNull();
    install({ STAGING_BASE_URL: "https://another.example.test" });
    expect(trainingStripe(local)).toBeNull();
  });

  it("rejects the production site with test credentials", () => {
    install({ SITE_ID: "93829451-dbcf-4863-a07f-fa448cb17494" });
    expect(
      trainingStripe({
        site: { id: "93829451-dbcf-4863-a07f-fa448cb17494" },
        deploy: { context: "production", published: true },
      } as never),
    ).toBeNull();
  });

  it("requires an exact production deployment, production database and explicit mode opt-in", () => {
    const production = {
      site: { id: "93829451-dbcf-4863-a07f-fa448cb17494" },
      deploy: { context: "production", published: true },
    } as never;
    const fixture = {
      E2E_EPHEMERAL: "false",
      TEST_RELEASE_CONTEXT: "production",
      URL: "https://portal.d-a-j.com",
      SUPABASE_URL: "https://htwthzshhilrjtqwprlo.supabase.co",
      STRIPE_SECRET_KEY: ["rk", "live", "fixture"].join("_"),
      STRIPE_WEBHOOK_SECRET: "test-signature-fixture",
      TRAINING_CHECKOUT_LIVE: "true",
    };
    install(fixture);
    expect(
      trainingStripe(production, "TRAINING_CHECKOUT_TEST_MODE")?.live,
    ).toBe(true);
    expect(trainingStripe(production)).toBeNull();
    install({ ...fixture, STRIPE_WEBHOOK_SECRET: "" });
    expect(
      trainingStripe(production, "TRAINING_CHECKOUT_TEST_MODE"),
    ).toBeNull();
    install({
      ...fixture,
      SUPABASE_URL: "https://lrxrivfqjpkvygozphoz.supabase.co",
    });
    expect(
      trainingStripe(production, "TRAINING_CHECKOUT_TEST_MODE"),
    ).toBeNull();
    install(fixture);
    expect(
      trainingStripe(
        {
          site: { id: "93829451-dbcf-4863-a07f-fa448cb17494" },
          deploy: { context: "production", published: false },
        } as never,
        "TRAINING_CHECKOUT_TEST_MODE",
      ),
    ).toBeNull();
  });

  it("keeps approval for one-time checkout independent", () => {
    install();
    expect(trainingStripe(local, "TRAINING_CHECKOUT_TEST_MODE")).toBeNull();
  });

  it("pins a protected preview to its isolated branch and refuses production", () => {
    const preview = {
      site: { id: "d83ff6cb-f57b-4741-8c3c-3eaae7adab19" },
      deploy: { context: "deploy-preview", published: false },
    } as never;
    const branch = "abcdefghijklmnopqrst";
    const env = {
      E2E_EPHEMERAL: "false",
      TRAINING_SANDBOX_SUPABASE_REF: branch,
      SUPABASE_URL: `https://${branch}.supabase.co`,
    };
    install(env);
    expect(trainingSandbox(preview)).toBe("staging");
    install({
      ...env,
      SUPABASE_URL: "https://lrxrivfqjpkvygozphoz.supabase.co",
    });
    expect(trainingSandbox(preview)).toBeNull();
    install({
      ...env,
      TRAINING_SANDBOX_SUPABASE_REF: "htwthzshhilrjtqwprlo",
      SUPABASE_URL: "https://htwthzshhilrjtqwprlo.supabase.co",
    });
    expect(trainingSandbox(preview)).toBeNull();
  });
});

it("returns the existing setup action when enrollment is already pending", async () => {
  rpc.mockResolvedValueOnce({
    error: {
      code: "P0001",
      message:
        "INVALID_TRANSITION: Finish or cancel the pending payment setup first.",
    },
  });
  await expect(autopay("begin", {})).rejects.toMatchObject({
    code: "VERSION_CONFLICT",
    status: 409,
    message: "Continue or cancel the pending automatic payment setup first.",
  });
});
