import { describe, expect, it, vi } from "vitest";
import type { Context } from "@netlify/functions";
vi.mock("./supabase", () => ({
  userClient: vi.fn(),
  serviceClient: vi.fn(),
}));
import { userClient, serviceClient } from "./supabase";
import handler from "../v2";

describe("automation HTTP authorization boundary", () => {
  it("returns structured 403 before privileged access when RLS yields no coach membership", async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "PGRST116" },
      }),
    };
    vi.mocked(userClient).mockReturnValue({
      from: vi.fn().mockReturnValue(query),
    } as unknown as ReturnType<typeof userClient>);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await handler(
        new Request("http://localhost/api/v2/automations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: "test_rule",
            entityId: "11111111-1111-4111-8111-111111111111",
            expectedVersion: 1,
            idempotencyKey: "role-boundary-regression",
            reason: "Verify non-coach denial",
            payload: {
              studentId: "22222222-2222-4222-8222-222222222222",
              entityId: "33333333-3333-4333-8333-333333333333",
            },
          }),
        }),
        {
          params: { domain: "automations" },
          requestId: "role-test",
        } as unknown as Context,
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "FORBIDDEN",
        correlationId: "role-test",
      });
      expect(query.eq).toHaveBeenCalledWith("role", "coach");
      expect(serviceClient).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
  it("does not infer a domain from nested paths or untrusted Origin headers", async () => {
    vi.mocked(userClient).mockClear();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await handler(
        new Request("http://localhost/api/v2/automations/extra", {
          method: "POST",
          headers: { Origin: "https://portal.d-a-j.com/api/v2/automations" },
        }),
        { params: {}, requestId: "path-test" } as unknown as Context,
      );
      expect(response.status).toBe(404);
      expect(userClient).not.toHaveBeenCalled();
      expect(serviceClient).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});
