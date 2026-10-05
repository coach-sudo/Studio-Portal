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
                insert: (row: (typeof messages)[number]) => {
                  insert(row);
                  return {
                    select: () => ({
                      single: async () => ({
                        data: {
                          id: `outbox-${messages.findIndex((m) => m.dedupe_key === row.dedupe_key)}`,
                          status: row.status,
                          event_key: row.event_key,
                          dedupe_key: row.dedupe_key,
                        },
                        error: null,
                      }),
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
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0][0]).not.toHaveProperty("entity_snapshot");
    expect(
      audit.mock.calls.map(
        (call) => (call[0] as { outbox_ids: string[] }).outbox_ids,
      ),
    ).toEqual([["outbox-0"], ["outbox-1"]]);
  });
  it("uses the existing partial unique index for race-safe dedupe, without swallowing other errors", async () => {
    const message = {
      studio_id: "studio",
      channel: "email",
      recipient: "payer@example.test",
      subject: "Due",
      body: "Hi Jordan,",
      dedupe_key: "same",
    };
    const result = {
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key violates unique constraint "outbox_messages_dedupe_idx"',
      },
    };
    const client = {
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => result }) }),
      }),
    } as unknown as SupabaseClient;
    await expect(
      queuePresentedMessages(
        client,
        [message],
        { name: "Coach’D" },
        "https://preview.example.test",
      ),
    ).resolves.toEqual([]);
    result.error.message =
      'duplicate key violates unique constraint "unrelated_index"';
    await expect(
      queuePresentedMessages(
        client,
        [message],
        { name: "Coach’D" },
        "https://preview.example.test",
      ),
    ).rejects.toMatchObject({ code: "23505" });
    result.error.code = "42P10";
    await expect(
      queuePresentedMessages(
        client,
        [message],
        { name: "Coach’D" },
        "https://preview.example.test",
      ),
    ).rejects.toMatchObject({ code: "42P10" });
  });
});
