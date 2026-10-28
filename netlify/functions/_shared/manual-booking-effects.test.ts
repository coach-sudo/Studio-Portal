// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { processManualBookingEffects } from "./manual-booking-effects";
const mock = vi.hoisted(() => ({ queue: vi.fn() }));
vi.mock("./booking-email", () => ({ queueBookingEmails: mock.queue }));
beforeEach(() => {
  vi.stubGlobal("Netlify", { env: { get: () => "true" } });
  mock.queue.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
const effect = {
  id: "effect",
  booking_id: "booking",
  claim_token: "fenced",
  manage_token: "synthetic-private-token",
};
const db = () => ({
  rpc: vi.fn(async (name) => ({
    data: name === "claim_manual_booking_effects" ? [effect] : true,
    error: null,
  })),
});
it("retains the canonical booking when notification production fails", async () => {
  const client = db();
  mock.queue.mockRejectedValue(Error("private payload"));
  await expect(processManualBookingEffects(client as never)).rejects.toThrow(
    /remains pending/,
  );
  expect(client.rpc).toHaveBeenLastCalledWith("finish_manual_booking_effect", {
    p_id: "effect",
    p_token: "fenced",
    p_failed: true,
  });
  expect(client).not.toHaveProperty("from");
});
it("uses the same booking identity when retrying queue production", async () => {
  const client = db();
  await processManualBookingEffects(client as never);
  await processManualBookingEffects(client as never);
  expect(mock.queue.mock.calls.map((c) => c.slice(1))).toEqual([
    ["booking", "synthetic-private-token"],
    ["booking", "synthetic-private-token"],
  ]);
});
it("does not queue stale or superseded work", async () => {
  const client = db();
  client.rpc.mockImplementation(async (name) => ({
    data:
      name === "claim_manual_booking_effects"
        ? [effect]
        : name !== "manual_booking_effect_current",
    error: null,
  }));
  await processManualBookingEffects(client as never);
  expect(mock.queue).not.toHaveBeenCalled();
});
