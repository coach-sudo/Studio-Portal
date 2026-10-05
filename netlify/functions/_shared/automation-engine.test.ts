import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReadinessData } from "../../../src/domain/lessonReadiness";
import { emailDefaults } from "./email-templates";
import type {
  Tables,
  TablesInsert,
} from "../../../src/types/database.generated";
import { evaluateAndQueueRule } from "./automation-engine";

vi.mock("./portal-url", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./portal-url")>()),
  portalOrigin: () => "https://preview.example.test",
}));

const now = Date.parse("2026-10-05T12:00:00Z");

function fixture({
  payerResolved = true,
  mode = "automatic",
  coachAvailable = true,
}: {
  payerResolved?: boolean;
  mode?: Tables<"automation_rules">["mode"];
  coachAvailable?: boolean;
} = {}) {
  const data: ReadinessData = {
    students: [
      {
        id: "student",
        studioId: "studio",
        fullName: "Student",
        email: "payer@example.test",
        isMinor: !payerResolved,
        status: "active",
        portalEnabled: true,
        actorPageEligible: false,
        version: 1,
        updatedAt: "",
      },
    ],
    linkedContacts: [],
    bookings: [],
    lessonParticipants: [],
    packages: [],
    packageDefinitions: [],
    creditEntries: [],
    payments: [],
    studentPricingRules: [],
    outbox: [],
    settings: {
      timezone: "America/New_York",
      currency: "USD",
      emailAutomations: { ...emailDefaults, enabled: true },
    },
    lessons: [
      {
        id: "lesson",
        studentId: "student",
        studioId: "studio",
        topic: "Coaching",
        locationType: "virtual",
        locationLabel: "Google Meet",
        version: 1,
        updatedAt: "",
        startsAt: "2026-10-05T18:00:00Z",
        endsAt: "2026-10-05T19:00:00Z",
        status: "scheduled",
        paymentStatus: "due",
        priceMinor: 8500,
        paidMinor: 0,
        packageId: undefined,
      },
    ],
  };
  const row: Tables<"automation_rules"> = {
    id: "rule",
    studio_id: "studio",
    rule_key: "payment_due",
    enabled: true,
    mode,
    trigger: "before_lesson",
    audience: "payment_due",
    timing: { hoursBefore: [2] },
    conditions: {},
    suppressions: [],
    escalation: { coach: true, hoursBefore: 1 },
    template: {},
    priority: 80,
    version: 1,
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
  const messages: (TablesInsert<"outbox_messages"> & { id: string })[] = [];
  const runs = new Map<string, TablesInsert<"automation_runs">>();
  const audit = vi.fn(
    async (run: TablesInsert<"automation_runs">, options: unknown) => {
      expect(options).toEqual({
        onConflict: "decision_key",
        ignoreDuplicates: true,
      });
      if (!runs.has(run.decision_key)) runs.set(run.decision_key, run);
      return { error: null };
    },
  );
  const client = {
    auth: {
      admin: {
        getUserById: async () => ({
          data: {
            user: { email: coachAvailable ? "coach@example.test" : undefined },
          },
          error: null,
        }),
      },
    },
    from(table: string) {
      switch (table) {
        case "studios": {
          const query = {
            select: () => query,
            eq: () => query,
            single: async () => ({
              data: { name: "Coach'D", settings: { coachName: "Coach" } },
              error: null,
            }),
          };
          return query;
        }
        case "memberships": {
          const query = {
            select: () => query,
            eq: () => query,
            limit: () => query,
            maybeSingle: async () => ({
              data: { user_id: "coach" },
              error: null,
            }),
          };
          return query;
        }
        case "automation_rules":
          return {
            select: () => ({
              in: async () => ({
                data: [{ id: row.id, template: row.template }],
                error: null,
              }),
            }),
          };
        case "automation_runs":
          return { upsert: audit };
        case "outbox_messages":
          return {
            insert: (message: TablesInsert<"outbox_messages">) => ({
              select: () => ({
                single: async () => {
                  if (
                    messages.some(
                      (existing) => existing.dedupe_key === message.dedupe_key,
                    )
                  )
                    return {
                      data: null,
                      error: {
                        code: "23505",
                        message:
                          'duplicate key violates unique constraint "outbox_messages_dedupe_idx"',
                      },
                    };
                  const inserted = {
                    ...message,
                    id: `outbox-${messages.length + 1}`,
                  };
                  messages.push(inserted);
                  return { data: inserted, error: null };
                },
              }),
            }),
          };
        default:
          throw new Error(`Unexpected database access: ${table}`);
      }
    },
  } as unknown as SupabaseClient;
  const evaluate = (preview = false) =>
    evaluateAndQueueRule(
      client,
      row,
      "lesson",
      data.students[0].id,
      "correlation",
      preview,
      now,
      { data },
    );
  const lastRun = () => audit.mock.calls.at(-1)![0];
  return { data, row, messages, runs, evaluate, lastRun };
}

function expectUnresolvedEvidence(run: TablesInsert<"automation_runs">) {
  expect(run.suppressed_reason).toBe("recipient_unresolved");
  expect(run.decision).toMatchObject({
    recipientIssue: "recipient_unresolved",
    recipients: [],
    unresolvedRecipients: [
      "A minor needs a linked payer with financial access.",
      "No eligible recipient remains for this event.",
    ],
  });
}

describe("automation engine audit results", () => {
  it("prepares a new approval draft when the balance changes, retaining old history and deduplicating unchanged balances", async () => {
    const f = fixture();
    await f.evaluate();
    f.data.lessons[0].paidMinor = 3500;
    expect((await f.evaluate()).result).toBe("draft");
    expect(f.messages).toHaveLength(2);
    expect(f.messages[0].body).toContain("$85.00");
    expect(f.messages[1].body).toContain("$50.00");
    expect(f.messages[1].entity_snapshot).toMatchObject({
      amountDueMinor: 5000,
    });
    expect((await f.evaluate()).result).toBe("duplicate");
    expect(f.messages).toHaveLength(2);
  });
  it.each(["automatic", "draft"])(
    "records successful payer %s queueing",
    async (mode) => {
      const f = fixture({ mode });
      const expected = "draft";
      expect(await f.evaluate()).toMatchObject({
        result: expected,
        outboxIds: ["outbox-1"],
      });
      expect(f.messages).toHaveLength(1);
      expect(f.messages[0]).toMatchObject({
        recipient: "payer@example.test",
        status: expected,
      });
      expect(f.lastRun()).toMatchObject({
        result: expected,
        suppressed_reason: null,
        decision: { recipientIssue: null, unresolvedRecipients: [] },
      });
    },
  );

  it.each(["automatic", "draft"])(
    "keeps unresolved payer %s runs unresolved without escalation",
    async (mode) => {
      const f = fixture({ payerResolved: false, mode });
      expect(await f.evaluate()).toMatchObject({
        result: "unresolved",
        outboxIds: [],
      });
      expect(f.messages).toHaveLength(0);
      expectUnresolvedEvidence(f.lastRun());
      // Draft does not introduce automatic coach escalation even when configured.
      expect(f.lastRun().decision).toMatchObject({
        stages: [{ key: "hours-2" }],
      });
    },
  );

  it("records a queued coach escalation while retaining the unresolved payer", async () => {
    const f = fixture({
      payerResolved: false,
      mode: "automatic_with_escalation",
    });
    expect(await f.evaluate()).toMatchObject({
      result: "queued",
      outboxIds: ["outbox-1"],
    });
    expect(f.messages).toHaveLength(1);
    expect(f.messages[0]).toMatchObject({
      recipient: "coach@example.test",
      recipient_intent: "coach",
      status: "queued",
      send_at: "2026-10-05T17:00:00.000Z",
      dedupe_key:
        "automation:payment_due:lesson:2026-10-05T18:00:00Z:coach-escalation:coach@example.test",
    });
    expect(f.lastRun()).toMatchObject({
      result: "queued",
      outbox_ids: ["outbox-1"],
    });
    expectUnresolvedEvidence(f.lastRun());
  });

  it("remains unresolved when neither payer nor coach escalation can receive mail", async () => {
    const f = fixture({
      payerResolved: false,
      mode: "automatic_with_escalation",
      coachAvailable: false,
    });
    expect(await f.evaluate()).toMatchObject({
      result: "unresolved",
      outboxIds: [],
    });
    expect(f.messages).toHaveLength(0);
    expectUnresolvedEvidence(f.lastRun());
  });

  it.each([true, false])(
    "preserves message and audit dedupe with payer resolved=%s",
    async (payerResolved) => {
      const f = fixture({
        payerResolved,
        mode: payerResolved ? "automatic" : "automatic_with_escalation",
      });
      expect((await f.evaluate()).result).toBe(
        payerResolved ? "draft" : "queued",
      );
      const original = structuredClone(f.messages);
      expect(await f.evaluate()).toMatchObject({
        result: "duplicate",
        outboxIds: [],
      });
      expect(f.lastRun().result).toBe("duplicate");
      if (!payerResolved) expectUnresolvedEvidence(f.lastRun());
      const runCount = f.runs.size;
      expect((await f.evaluate()).result).toBe("duplicate");
      expect(f.messages).toEqual(original);
      expect(f.runs.size).toBe(runCount);
    },
  );

  it("preview retains recipient evidence but never queues an escalation", async () => {
    const f = fixture({
      payerResolved: false,
      mode: "automatic_with_escalation",
    });
    expect(await f.evaluate(true)).toMatchObject({
      result: "not_due",
      outboxIds: [],
    });
    expect(f.messages).toHaveLength(0);
    expectUnresolvedEvidence(f.lastRun());
  });

  it("resolved conditions remain suppressed regardless of recipient availability", async () => {
    const f = fixture({
      payerResolved: false,
      mode: "automatic_with_escalation",
    });
    f.data.lessons[0].paymentStatus = "paid";
    expect(await f.evaluate()).toMatchObject({
      result: "suppressed",
      outboxIds: [],
    });
    expect(f.messages).toHaveLength(0);
    expect(f.lastRun().suppressed_reason).toBe("condition_resolved");
  });
});
