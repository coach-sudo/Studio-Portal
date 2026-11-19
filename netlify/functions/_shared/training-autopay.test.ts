import { afterEach, describe, expect, it, vi } from "vitest";
import { testAutopayStripe } from "./training-autopay";

vi.mock("./release", () => ({ releaseMetadata: () => ({ context: "local" }) }));

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

describe("test-only lesson billing", () => {
  it("enables a test key on the disposable loopback candidate", () => {
    install();
    expect(testAutopayStripe(local)?.origin).toBe(settings.STAGING_BASE_URL);
  });

  it("rejects live keys even when all test flags are set", () => {
    install({ STRIPE_SECRET_KEY: ["sk", "live", "fixture"].join("_") });
    expect(testAutopayStripe(local)).toBeNull();
  });

  it("rejects missing opt-in and non-loopback ephemeral origins", () => {
    install({ TRAINING_AUTOPAY_TEST_MODE: "false" });
    expect(testAutopayStripe(local)).toBeNull();
    install({ STAGING_BASE_URL: "https://another.example.test" });
    expect(testAutopayStripe(local)).toBeNull();
  });

  it("rejects the production site with test credentials", () => {
    install({ SITE_ID: "93829451-dbcf-4863-a07f-fa448cb17494" });
    expect(
      testAutopayStripe({
        site: { id: "93829451-dbcf-4863-a07f-fa448cb17494" },
        deploy: { context: "production", published: true },
      } as never),
    ).toBeNull();
  });

  it("keeps approval for one-time checkout independent", () => {
    install();
    expect(testAutopayStripe(local, "TRAINING_CHECKOUT_TEST_MODE")).toBeNull();
  });
});
