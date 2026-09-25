import type { Context } from "@netlify/functions";
import { afterEach, describe, expect, it, vi } from "vitest";

const deployment = vi.hoisted(() => ({ context: "production" }));

vi.mock("../../netlify/functions/_shared/release", () => ({
  releaseMetadata: () => ({
    commit: "abcdef012345",
    context: deployment.context,
  }),
}));
vi.mock("../../netlify/functions/_shared/supabase", () => ({
  serviceClient: vi.fn(() => {
    throw new Error("Production fixtures must not reach the database.");
  }),
}));

import fixtures from "../../netlify/functions/e2e-fixtures";
import { serviceClient } from "../../netlify/functions/_shared/supabase";

describe("production-context fixture safety", () => {
  afterEach(() => {
    deployment.context = "production";
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("rejects setup before reading a token, body, or database", async () => {
    const request = new Request(
      "https://immutable--studio-portal.netlify.app/api/e2e/fixtures",
      {
        method: "POST",
        body: JSON.stringify({ action: "setup", runId: "e2e-release-test" }),
      },
    );
    const response = await fixtures(request, { requestId: "test" } as Context);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: "E2E fixtures are disabled in production.",
    });
    expect(serviceClient).not.toHaveBeenCalled();
  });

  it("rejects a non-production request when no fixture token is configured", async () => {
    deployment.context = "deploy-preview";
    vi.stubGlobal("Netlify", { env: { get: () => undefined } });
    const response = await fixtures(
      new Request(
        "https://deploy-preview-20--coachd-staging.netlify.app/api/e2e/fixtures",
        { method: "POST", body: "{}" },
      ),
      { requestId: "test" } as Context,
    );

    expect(response.status).toBe(401);
    expect(serviceClient).not.toHaveBeenCalled();
  });
});
