// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("./portal-url", async () => ({
  ...(await vi.importActual<typeof import("./portal-url")>("./portal-url")),
  portalOrigin: () => "https://isolated.example.test",
}));
vi.mock("./notification-recipients", () => ({
  resolveEventRecipients: vi.fn(async (_client, studentId) => ({
    recipients: [{ email: `${studentId}@example.test` }],
    suppressed: [],
  })),
}));
vi.mock("./outbox-queue", () => ({
  compatibleRule: vi.fn(async () => null),
  compatibleQueueStatus: vi.fn(() => "queued"),
  queuePresentedMessages: vi.fn(),
}));
import { queuePresentedMessages } from "./outbox-queue";
import { resolveEventRecipients } from "./notification-recipients";
import { processLessonChangeEffects } from "./lesson-notifications";
const effect = {
  id: "effect-1",
  lesson_id: "lesson-one",
  kind: "cancelled",
  lesson_version: 2,
  student_ids: ["affected"],
  participant_ids: ["participant-one"],
  booking_id: "booking-one" as string | null,
  snapshot: {
    startsAt: "2099-01-01T12:00:00Z",
    endsAt: "2099-01-01T13:00:00Z",
    status: "scheduled",
  },
  correlation_id: "change",
  claim_token: "token",
};
function client(kind = "cancelled") {
  const filters: { table: string; field: string; value: unknown }[] = [];
  const current = { ...effect, kind };
  const lesson = {
    id: effect.lesson_id,
    studio_id: "studio",
    student_id: null as string | null,
    version: 12,
    topic: "Shared class",
    starts_at: effect.snapshot.startsAt,
    ends_at: effect.snapshot.endsAt,
    status: "scheduled",
    location_label: "Studio",
  };
  const rows: Record<string, unknown> = {
    lessons: lesson,
    studios: {
      name: "Studio",
      settings: { emailAutomations: { enabled: true, reminders: true } },
    },
    students: { full_name: "Affected" },
    lesson_participants: [
      {
        id: "participant-one",
        student_id: "affected",
        booking_id: "booking-one",
        status: kind === "cancelled" ? "cancelled" : "confirmed",
      },
      {
        id: "withdrawn-before-change",
        student_id: "withdrawn",
        booking_id: "booking-old",
        status: "cancelled",
      },
      {
        id: "unrelated",
        student_id: "unrelated",
        booking_id: "booking-other",
        status: "confirmed",
      },
    ],
  };
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === "claim_lesson_change_effects"
        ? { effects: [current], tracked: true }
        : true,
    error: null,
  }));
  const db = {
    rpc,
    from: (table: string) => {
      const q = {
        select: () => q,
        update: () => q,
        in: () => q,
        match: () => q,
        or: (value: string) => {
          filters.push({ table, field: "scope", value });
          return q;
        },
        eq: (field: string, value: unknown) => {
          filters.push({ table, field, value });
          return q;
        },
        single: async () => ({ data: rows[table], error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: rows[table], error: null }).then(resolve),
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, rpc, filters, lesson, current };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queuePresentedMessages).mockImplementation(
    async (_db, messages) =>
      messages.map((m, i) => ({ id: String(i), ...m })) as never,
  );
});
describe("occurrence notification intent", () => {
  it("characterizes the unresolved legacy/effect dedupe gap during a rolling cutover", async () => {
    const { db, lesson, current } = client();
    current.booking_id = null;
    current.snapshot = { ...current.snapshot, status: "cancelled" };
    lesson.student_id = "affected";
    lesson.status = "cancelled";
    lesson.version = current.lesson_version;
    // Published 6df35d7 queues by the returned lesson version after the RPC.
    // Migrated SQL also leaves a durable effect for the replacement worker.
    // The partial unique index compares exact dedupe keys, not semantic events.
    const legacyKey = `lesson:${lesson.id}:${lesson.version}:cancelled:student:affected@example.test`;
    const queuedKeys = new Set([legacyKey]);
    vi.mocked(queuePresentedMessages).mockImplementation(
      async (_db, messages) => {
        for (const message of messages) queuedKeys.add(message.dedupe_key!);
        return messages.map((m, i) => ({ id: String(i), ...m })) as never;
      },
    );
    expect((await processLessonChangeEffects(db)).failed).toBe(0);
    expect(queuedKeys).toEqual(
      new Set([
        legacyKey,
        "lesson:lesson-one:effect-1:cancelled:student:affected@example.test",
      ]),
    );
    // Characterization of a blocked release path; this is NOT a safety PASS.
    // A validated cutover or concurrency-safe bridge must reduce this to one.
  });
  it("retains the withdrawn occurrence's original time when the remaining class changes", async () => {
    const { db, lesson } = client();
    lesson.status = "cancelled";
    lesson.starts_at = "2099-02-01T12:00:00Z";
    lesson.ends_at = "2099-02-01T13:00:00Z";
    const result = await processLessonChangeEffects(db);
    expect(result.failed).toBe(0);
    const message = vi.mocked(queuePresentedMessages).mock.calls[0][1][0];
    expect(message.entity_snapshot).toMatchObject({
      startsAt: effect.snapshot.startsAt,
      bookingCancellation: true,
    });
    expect(message.recipient).toBe("affected@example.test");
  });
  it("notifies only the frozen withdrawal cohort and supersedes only its occurrence reminders", async () => {
    const { db, filters } = client();
    const result = await processLessonChangeEffects(db);
    expect(result.failed).toBe(0);
    expect(
      vi.mocked(resolveEventRecipients).mock.calls.map(([, id]) => id),
    ).toEqual(["affected"]);
    expect(filters).toContainEqual({
      table: "outbox_messages",
      field: "lesson_id",
      value: "lesson-one",
    });
    expect(filters).toContainEqual({
      table: "outbox_messages",
      field: "scope",
      value:
        "booking_id.eq.booking-one,and(booking_id.is.null,student_id.eq.affected)",
    });
    expect(vi.mocked(queuePresentedMessages).mock.calls[0][1]).toEqual([
      expect.objectContaining({
        student_id: "affected",
        booking_id: "booking-one",
        event_key: "lesson.cancelled.student",
        dedupe_key: expect.stringContaining("effect-1"),
        recipient: "affected@example.test",
      }),
    ]);
  });
  it("uses stable outbox dedupe after a partial queue failure and a changed financial version", async () => {
    const { db, rpc } = client();
    vi.mocked(queuePresentedMessages).mockRejectedValueOnce(
      Error("partial queue failure"),
    );
    expect((await processLessonChangeEffects(db)).failed).toBe(1);
    expect(rpc).toHaveBeenCalledWith(
      "finish_lesson_change_effect",
      expect.objectContaining({ p_failed: true }),
    );
    expect((await processLessonChangeEffects(db)).failed).toBe(0);
    const attempts = vi.mocked(queuePresentedMessages).mock.calls;
    expect(attempts[0][1][0].dedupe_key).toBe(attempts[1][1][0].dedupe_key);
  });
  it("reschedules reminders only for the reviewed cohort", async () => {
    const { db } = client("rescheduled");
    await processLessonChangeEffects(db);
    expect(
      vi.mocked(resolveEventRecipients).mock.calls.map(([, id]) => id),
    ).toEqual(["affected", "affected"]);
    const messages = vi.mocked(queuePresentedMessages).mock.calls[0][1];
    expect(
      messages.every(
        (m) => m.student_id === "affected" && m.lesson_id === "lesson-one",
      ),
    ).toBe(true);
    expect(
      messages.filter((m) => m.recipient_intent === "lesson_reminder"),
    ).toHaveLength(2);
  });
});
