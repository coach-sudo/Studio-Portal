// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { captureReviewActor } from "./reviewActor";
const getSession = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase", () => ({ supabase: { auth: { getSession } } }));
beforeEach(() => vi.resetAllMocks());
it("captures only the original authenticated actor, not a token or account payload", async () => {
  getSession.mockResolvedValue({
    data: { session: { user: { id: "coach-a" }, access_token: "private" } },
    error: null,
  });
  expect(await captureReviewActor()).toBe("coach-a");
});
it("requires fresh sign-in when no valid authenticated review owner is available", async () => {
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  await expect(captureReviewActor()).rejects.toThrow("Sign in as the coach");
  getSession.mockResolvedValue({
    data: { session: { user: { id: "untrusted" } } },
    error: Error("Refresh failed"),
  });
  await expect(captureReviewActor()).rejects.toThrow("Sign in as the coach");
});
