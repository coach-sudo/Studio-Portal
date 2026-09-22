import { describe, expect, it } from "vitest";
import { ApiClientError, readApiClientError } from "./apiClientError";

describe("ApiClientError", () => {
  it("retains stable server error fields for code-based client handling", async () => {
    const error = await readApiClientError(
      Response.json(
        {
          code: "VERSION_CONFLICT",
          message: "Review the current version.",
          retryable: false,
          correlationId: "correlation-1",
          details: { expectedVersion: 4 },
        },
        { status: 409 },
      ),
      "Fallback",
    );
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
      retryable: false,
      correlationId: "correlation-1",
      details: { expectedVersion: 4 },
    });
  });

  it("uses a predictable fallback when an older endpoint is not structured", async () => {
    const error = await readApiClientError(
      new Response("gateway failure", { status: 502 }),
      "The request failed.",
    );
    expect(error).toMatchObject({
      code: "HTTP_ERROR",
      message: "The request failed.",
      status: 502,
      retryable: true,
    });
  });
});
