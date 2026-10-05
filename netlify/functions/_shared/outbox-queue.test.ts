import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compatibleQueueStatus, queuePresentedMessages } from "./outbox-queue";
describe("compatible structured queue", () => {
  it("preserves defaults, off and review-only draft mode", () => {
    expect(compatibleQueueStatus(null, false)).toBeUndefined();
    expect(compatibleQueueStatus(null, true)).toBe("queued");
    expect(
      compatibleQueueStatus({ enabled: true, mode: "draft" } as never),
    ).toBe("draft");
    expect(
      compatibleQueueStatus({ enabled: false, mode: "automatic" } as never),
    ).toBeUndefined();
  });
  it("audits the correct outbox ID for each recipient sharing an event and preserves database defaults", async () => {
    const audit = vi.fn(async (_row: unknown, _options: unknown) => ({
        error: null,
      })),
      insert = vi.fn();
    const messages = ["payer", "scheduler"].map((name) => ({
      studio_id: "studio",
      student_id: "student",
      recipient: `${name}@example.test`,
      channel: "email",
      subject: "Upcoming lesson",
      body: "Hi Jordan,\n\nYour lesson is tomorrow.",
      event_key: "booking.reminder.student",
      dedupe_key: name,
      status: "queued" as const,
      automation_rule_id: "rule",
    }));
    const client = {
      from: (table: string) =>
        table === "automation_rules"
          ? {
              select: () => ({
                in: async () => ({
                  data: [{ id: "rule", template: {} }],
                  error: null,
                }),
              }),
            }
          : table === "automation_runs"
            ? { upsert: audit }
            : {
                upsert: (rows: unknown, options: unknown) => {
                  insert(rows, options);
                  return {
                    select: async () => ({
                      data: messages.map((m, i) => ({
                        id: `outbox-${i}`,
                        status: m.status,
                        event_key: m.event_key,
                        dedupe_key: m.dedupe_key,
                      })),
                      error: null,
                    }),
                  };
                },
              },
    } as unknown as SupabaseClient;
    await queuePresentedMessages(
      client,
      messages,
      { name: "Coach’D" },
      "https://preview.example.test",
    );
    expect(insert.mock.calls[0][1]).toMatchObject({
      defaultToNull: false,
      ignoreDuplicates: true,
    });
    expect(
      audit.mock.calls.map(
        (call) => (call[0] as { outbox_ids: string[] }).outbox_ids,
      ),
    ).toEqual([["outbox-0"], ["outbox-1"]]);
  });
});
