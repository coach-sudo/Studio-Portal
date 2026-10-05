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

  it.each([
    ["https://portal.d-a-j.com", "GET"],
    ["https://portal.d-a-j.com", "POST"],
    ["https://www.portal.d-a-j.com", "GET"],
    ["https://www.portal.d-a-j.com", "POST"],
    ["https://immutable--studio-portal.netlify.app", "GET"],
    ["https://immutable--studio-portal.netlify.app", "POST"],
  ])(
    "rejects production %s %s before any fixture access",
    async (origin, method) => {
      const envGet = vi.fn();
      vi.stubGlobal("Netlify", { env: { get: envGet } });
      const request = new Request(`${origin}/api/e2e/fixtures`, {
        method,
        ...(method === "POST"
          ? {
              body: JSON.stringify({
                action: "setup",
                runId: "e2e-release-test",
              }),
            }
          : {}),
      });
      const readBody = vi.spyOn(request, "json");
      const readHeader = vi.spyOn(request.headers, "get");
      const response = await fixtures(request, {
        requestId: "test",
      } as Context);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        message: "E2E fixtures are disabled in production.",
      });
      expect(serviceClient).not.toHaveBeenCalled();
      expect(envGet).not.toHaveBeenCalled();
      expect(readBody).not.toHaveBeenCalled();
      expect(readHeader).not.toHaveBeenCalled();
    },
  );

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
