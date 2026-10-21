import { it, expect, vi, afterEach } from "vitest";
const state = vi.hoisted(() => ({
  last: new Date(Date.now() - 3600000).toISOString(),
}));
vi.mock("./supabase", () => {
  const client = {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      let failed = false;
      for (const method of ["select", "not", "order", "limit"])
        q[method] = () => q;
      q.eq = (key: string, value: unknown) => {
        if (key === "status" && value === "failed") failed = true;
        return q;
      };
      const result = () =>
        Promise.resolve({
          error: null,
          data:
            table === "memberships"
              ? { studio_id: "synthetic-studio" }
              : table === "studios"
                ? { id: "synthetic-studio" }
                : failed
                  ? null
                  : table === "calendar_projections"
                    ? { last_projected_at: state.last }
                    : { updated_at: state.last },
        });
      q.single = result;
      q.maybeSingle = result;
      return q;
    },
  };
  return { serviceClient: () => client, userClient: () => client };
});
import health from "../platform-health";
afterEach(() => vi.unstubAllGlobals());
it("reports configuration and saved success evidence without provider or worker probes", async () => {
  vi.stubGlobal("Netlify", { env: { get: () => "configured-fixture" } });
  const fetch = vi.fn(() => {
    throw new Error("Outbound networking forbidden");
  });
  vi.stubGlobal("fetch", fetch);
  const response = await health(
    new Request("https://staging.example.test/api/v2/health", {
      headers: { authorization: "Bearer synthetic-session" },
    }),
  );
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.integrations.googleCalendar).toMatchObject({
    state: "working",
    lastSuccessAt: state.last,
  });
  expect(body.integrations.stripe.state).toBe("configured_unverified");
  expect(body.integrations.scheduledWorkers.state).toBe(
    "configured_unverified",
  );
  expect(body.stripe).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
