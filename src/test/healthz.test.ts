import { describe, expect, it } from "vitest";
import healthz from "../../netlify/functions/healthz";
import platformHealth from "../../netlify/functions/platform-health";
import { releaseMetadata } from "../../netlify/functions/_shared/release";

describe("health endpoints", () => {
  it("keeps public liveness free of provider detail", async () => {
    const response = await healthz();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.release).toEqual(expect.any(Object));
    expect(body.release).toEqual(releaseMetadata());
    expect(body.checkedAt).toEqual(expect.any(String));
    expect(body).not.toHaveProperty("supabase");
    expect(body).not.toHaveProperty("stripe");
    expect(body).not.toHaveProperty("issues");
  });

  it("requires authentication for provider health", async () => {
    const response = await platformHealth(
      new Request("https://staging.example.test/api/v2/health"),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({
      code: "UNAUTHENTICATED",
      retryable: false,
    });
    expect(body.correlationId).toEqual(expect.any(String));
  });
});
