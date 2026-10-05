import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.generated";
import { clearDeliveredPortalCredentials } from "./outbox-retention";

describe("temporary portal credential retention", () => {
  it("clears both renderings only on old delivered credential mail and retains its history", async () => {
    const rows = [
      {
        id: "old",
        event_key: "portal.credentials",
        status: "sent",
        updated_at: "2026-09-27T00:00:00Z",
      },
      {
        id: "queued",
        event_key: "portal.credentials",
        status: "queued",
        updated_at: "2026-09-27T00:00:00Z",
      },
      {
        id: "recent",
        event_key: "portal.credentials",
        status: "sent",
        updated_at: "2026-10-01T00:00:00Z",
      },
      {
        id: "other",
        event_key: "booking.reminder.student",
        status: "sent",
        updated_at: "2026-09-27T00:00:00Z",
      },
    ].map((row) => ({
      ...row,
      body: "Ephemeral credential fixture",
      html_body: "<p>Ephemeral credential fixture</p>" as string | null,
    }));
    const baseline = structuredClone(rows);
    const filters: Record<string, string> = {};
    let content: Partial<(typeof rows)[number]> = {};
    const query = {
      update: (value: typeof content) => {
        content = value;
        return query;
      },
      eq: (key: string, value: string) => {
        filters[key] = value;
        return query;
      },
      lt: async (key: string, value: string) => {
        for (const row of rows)
          if (
            row.updated_at < value &&
            key === "updated_at" &&
            row.event_key === filters.event_key &&
            row.status === filters.status
          )
            Object.assign(row, content);
        return { error: null };
      },
    };
    const db = { from: vi.fn(() => query) };
    await clearDeliveredPortalCredentials(
      db as unknown as SupabaseClient<Database>,
      "2026-09-28T00:00:00Z",
    );
    expect(db.from).toHaveBeenCalledWith("outbox_messages");
    expect(rows[0]).toEqual({
      ...baseline[0],
      body: "Temporary portal credentials removed after delivery retention period.",
      html_body: null,
    });
    expect(rows.slice(1)).toEqual(baseline.slice(1));
  });
  it("reports a failed purge instead of silently claiming credentials were removed", async () => {
    const error = { code: "42501", message: "Fixture permission denied" };
    const query = {
      update: () => query,
      eq: () => query,
      lt: async () => ({ error }),
    };
    const db = { from: () => query } as unknown as SupabaseClient<Database>;
    await expect(
      clearDeliveredPortalCredentials(db, "2026-09-28T00:00:00Z"),
    ).rejects.toBe(error);
  });
});
