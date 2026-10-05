import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tables } from "../../../src/types/database.generated";
import type { ReadinessData } from "../../../src/domain/lessonReadiness";
import { emailDefaults } from "./email-templates";
import { checkOutboxEligibility, messageIntent } from "./outbox-eligibility";
vi.mock("./notification-recipients", () => ({
  resolveEventRecipients: vi.fn(async () => ({
    recipients: [{ email: "payer@example.test" }],
    suppressed: [],
  })),
}));
vi.mock("./operational-data", () => ({ loadOperationalData: vi.fn() }));
import { loadOperationalData } from "./operational-data";
import { resolveEventRecipients } from "./notification-recipients";
const message = {
  id: "message",
  studio_id: "studio",
  student_id: "student",
  lesson_id: "lesson",
  booking_id: null,
  event_key: "automation.payment_due.hours-24",
  recipient_intent: "payment_due",
  recipient: "payer@example.test",
  entity_snapshot: {
    startsAt: "2026-10-06T12:00:00Z",
    endsAt: "2026-10-06T13:00:00Z",
  },
  automation_rule_id: null,
  campaign_id: null,
} as unknown as Tables<"outbox_messages">;
const now = Date.parse("2026-10-05T12:00:00Z");
function client(rows: Record<string, unknown>) {
  return {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({
          data:
            table === "studios"
              ? (rows[table] ?? { settings: {} })
              : rows[table],
          error: null,
        }),
        maybeSingle: async () => ({ data: rows[table], error: null }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}
function data(): ReadinessData {
  return {
    students: [
      {
        id: "student",
        studioId: "studio",
        fullName: "Student",
        email: "student@example.test",
        isMinor: false,
        status: "active",
        portalEnabled: true,
        actorPageEligible: false,
        version: 1,
        updatedAt: "",
      },
    ],
    packages: [],
    creditEntries: [],
    bookings: [],
    lessonParticipants: [],
    linkedContacts: [],
    packageDefinitions: [],
    studentPricingRules: [],
    payments: [],
    outbox: [],
    settings: {
      timezone: "America/New_York",
      currency: "USD",
      emailAutomations: emailDefaults,
    },
    lessons: [
      {
        studioId: "studio",
        topic: "Coaching",
        locationType: "virtual",
        locationLabel: "Google Meet",
        version: 1,
        updatedAt: "",
        id: "lesson",
        studentId: "student",
        paymentStatus: "due",
        priceMinor: 8500,
        paidMinor: 0,
        packageId: undefined,
        status: "scheduled",
        startsAt: "2026-10-06T12:00:00Z",
        endsAt: "2026-10-06T13:00:00Z",
      },
    ],
  };
}
const rows = {
  lessons: {
    student_id: "student",
    status: "scheduled",
    starts_at: "2026-10-06T12:00:00+00:00",
    ends_at: "2026-10-06T13:00:00+00:00",
  },
};
beforeEach(() => {
  vi.mocked(loadOperationalData).mockResolvedValue(data());
  vi.mocked(resolveEventRecipients).mockResolvedValue({
    recipients: [
      {
        email: "payer@example.test",
        source: "linked_contact",
        reason: "Primary payer",
      },
    ],
    suppressed: [],
    unresolved: [],
  });
});
describe("dispatch-time authoritative suppression", () => {
  it("accepts equivalent UTC representations without false reschedule suppression", async () => {
    expect(await checkOutboxEligibility(client(rows), message, now)).toEqual({
      allowed: true,
    });
  });
  it("stops cancelled lesson reminders before recipient or provider work", async () => {
    expect(
      await checkOutboxEligibility(
        client({ lessons: { ...rows.lessons, status: "cancelled" } }),
        { ...message, recipient_intent: "lesson_reminder" },
        now,
      ),
    ).toEqual({ allowed: false, reason: "lesson_not_scheduled" });
  });
  it("permits a recorded past-due follow-up after completion, but never after cancellation", async () => {
    const value = data();
    value.lessons[0].status = "completed";
    vi.mocked(loadOperationalData).mockResolvedValue(value);
    const pastDue = { ...message, recipient_intent: "payment_past_due" };
    expect(
      await checkOutboxEligibility(
        client({ lessons: { ...rows.lessons, status: "completed" } }),
        pastDue,
        now,
      ),
    ).toEqual({ allowed: true });
    expect(
      await checkOutboxEligibility(
        client({ lessons: { ...rows.lessons, status: "cancelled" } }),
        pastDue,
        now,
      ),
    ).toEqual({ allowed: false, reason: "lesson_not_scheduled" });
  });
  it("stops obsolete timing after rescheduling", async () => {
    expect(
      await checkOutboxEligibility(
        client({
          lessons: { ...rows.lessons, starts_at: "2026-10-07T12:00:00Z" },
        }),
        message,
        now,
      ),
    ).toEqual({ allowed: false, reason: "lesson_rescheduled" });
  });
  it("stops billing after payment or waiver resolves", async () => {
    for (const status of ["paid", "waived", "paid_by_credit"] as const) {
      const value = data();
      value.lessons[0].paymentStatus = status;
      vi.mocked(loadOperationalData).mockResolvedValue(value);
      expect(await checkOutboxEligibility(client(rows), message, now)).toEqual({
        allowed: false,
        reason: "financial_condition_resolved",
      });
    }
  });
  it("stops when a contact loses permission or disables preferences", async () => {
    vi.mocked(resolveEventRecipients).mockResolvedValue({
      recipients: [],
      suppressed: [],
      unresolved: [],
    });
    expect(await checkOutboxEligibility(client(rows), message, now)).toEqual({
      allowed: false,
      reason: "recipient_no_longer_eligible",
    });
  });
  it("stops provider payment-failure email after successful booking payment", async () => {
    expect(
      await checkOutboxEligibility(
        client({ bookings: { payment_status: "paid", status: "confirmed" } }),
        {
          ...message,
          lesson_id: null,
          booking_id: "booking",
          recipient_intent: "payment_failed",
        },
        now,
      ),
    ).toEqual({ allowed: false, reason: "financial_condition_resolved" });
  });
  it("keeps legacy automatic producers on the same event-aware recipient boundary", () => {
    expect(
      messageIntent({
        recipient_intent: null,
        event_key: "portal.credentials",
      }),
    ).toBe("account_access");
    expect(
      messageIntent({
        recipient_intent: null,
        event_key: "booking.reminder.student",
      }),
    ).toBe("lesson_reminder");
    expect(
      messageIntent({
        recipient_intent: null,
        event_key: "package.expiring.student",
      }),
    ).toBe("package_expiration");
    expect(
      messageIntent({ recipient_intent: null, event_key: "manual.email" }),
    ).toBeUndefined();
  });
});
