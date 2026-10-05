import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDeliveryFailureData } from "./operational-data";
function client(error: unknown = null) {
  const eq = vi.fn();
  const db = {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: (...args: unknown[]) => {
          eq(table, ...args);
          return query;
        },
        single: async () =>
          table === "studios"
            ? {
                data: { settings: {}, timezone: "America/New_York" },
                error: null,
              }
            : {
                data: {
                  id: "message",
                  status: "failed",
                  channel: "email",
                  recipient: "guest@example.test",
                  subject: "Booking",
                  body: "Hello",
                  attempts: 1,
                  version: 1,
                  updated_at: "",
                  student_id: null,
                },
                error,
              },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { db, eq };
}
describe("studio-scoped delivery failure context", () => {
  it("supports guest/invite/campaign failures without inventing a student identity", async () => {
    const { db, eq } = client();
    const result = await loadDeliveryFailureData(db, "studio", "message");
    expect(result.students).toEqual([]);
    expect(result.outbox[0].status).toBe("failed");
    expect(result.outbox[0].studentId).toBeUndefined();
    expect(eq).toHaveBeenCalledWith("outbox_messages", "studio_id", "studio");
    expect(eq).toHaveBeenCalledWith("outbox_messages", "id", "message");
  });
  it("fails closed when the scoped message cannot be read", async () => {
    await expect(
      loadDeliveryFailureData(
        client({ code: "PGRST116" }).db,
        "studio",
        "unrelated",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
