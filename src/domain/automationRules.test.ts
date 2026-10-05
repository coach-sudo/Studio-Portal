import { describe, expect, it } from "vitest";
import { demoSnapshot } from "../data/demo";
import { evaluateAutomationRule, type AutomationRule } from "./automationRules";

const now = Date.parse("2026-10-04T12:00:00Z");
const rule: AutomationRule = {
  id: "rule",
  studioId: "studio",
  key: "payment_due",
  enabled: true,
  mode: "automatic",
  trigger: "before_lesson",
  audience: "payment_due",
  timing: { hoursBefore: [72, 24, 2] },
  conditions: {},
  suppressions: [],
  escalation: {},
  template: {},
  priority: 80,
  version: 1,
  updatedAt: "",
};
function fixture() {
  const data = structuredClone(demoSnapshot);
  data.bookings = [];
  data.lessonParticipants = [];
  data.packages = [];
  data.creditEntries = [];
  const lesson = {
    ...data.lessons[0],
    id: "lesson",
    startsAt: "2026-10-05T18:00:00Z",
    endsAt: "2026-10-05T19:00:00Z",
    status: "scheduled" as const,
    paymentStatus: "due" as const,
    priceMinor: 8500,
    paidMinor: 0,
    packageId: undefined,
  };
  data.lessons = [lesson];
  return { data, lesson };
}
describe("constrained automation decisions", () => {
  it("past-due follow-up has one stable stage and stops immediately on resolution", () => {
    const { data, lesson } = fixture();
    data.bookings = [
      {
        ...demoSnapshot.bookings[0],
        id: "booking",
        studentId: lesson.studentId,
        startsAt: lesson.startsAt,
        endsAt: lesson.endsAt,
        status: "confirmed",
        paymentPolicy: "pay_later",
        paymentStatus: "past_due",
        totalMinor: 8500,
        paidMinor: 0,
      },
    ];
    const pastDue = {
      ...rule,
      key: "payment_past_due" as const,
      audience: "payment_past_due" as const,
    };
    const later = Date.parse(lesson.endsAt) + 86400000;
    expect(
      evaluateAutomationRule(pastDue, { lesson }, data, later),
    ).toMatchObject({ eligible: true, stages: [{ key: "past-due" }] });
    data.bookings[0].paymentStatus = "paid";
    expect(
      evaluateAutomationRule(pastDue, { lesson }, data, later).suppressedReason,
    ).toBe("condition_resolved");
  });
  it("master switch suppresses an enabled structured rule", () => {
    const { data, lesson } = fixture();
    data.settings.emailAutomations.enabled = false;
    expect(
      evaluateAutomationRule(rule, { lesson }, data, now).suppressedReason,
    ).toBe("automation_disabled");
  });
  it("one remaining replacement credit is sufficient to suppress a stale package warning", () => {
    const { data } = fixture();
    data.packages = ["old", "new"].map((id) => ({
      id,
      studentId: data.students[0].id,
      name: "Package",
      autoApply: true,
      priceMinor: 0,
      currency: "USD",
      version: 1,
      updatedAt: "",
    }));
    data.creditEntries = [
      {
        id: "purchase",
        packageId: "new",
        quantity: 1,
        kind: "purchase",
        reason: "Renewal",
        createdAt: "",
      },
    ];
    expect(
      evaluateAutomationRule(
        { ...rule, key: "package_low", audience: "package_low" },
        { package: data.packages[0] },
        data,
        now,
      ).suppressedReason,
    ).toBe("package_renewed");
  });
  it("supports multiple configurable PAYG stages without replaying all missed stages", () => {
    const { data, lesson } = fixture();
    const result = evaluateAutomationRule(rule, { lesson }, data, now);
    expect(result.eligible).toBe(true);
    expect(result.stages.map((stage) => stage.key)).toEqual([
      "hours-24",
      "hours-2",
      "hours-72",
    ]);
    const later = evaluateAutomationRule(
      rule,
      { lesson },
      data,
      Date.parse(lesson.startsAt) - 3_600_000,
    );
    expect(later.stages.map((stage) => stage.key)).toEqual(["hours-2"]);
  });
  it("draft mode evaluates normally but is explicitly retained for the queue owner", () => {
    const { data, lesson } = fixture();
    expect(
      evaluateAutomationRule({ ...rule, mode: "draft" }, { lesson }, data, now)
        .eligible,
    ).toBe(true);
  });
  it("off mode cannot generate stages", () => {
    const { data, lesson } = fixture();
    expect(
      evaluateAutomationRule({ ...rule, mode: "off" }, { lesson }, data, now),
    ).toMatchObject({
      eligible: false,
      suppressedReason: "rule_off",
      stages: [],
    });
  });
  it("suppresses after payment, waiver, or applicable package coverage", () => {
    const { data, lesson } = fixture();
    for (const paymentStatus of ["paid", "waived"] as const)
      expect(
        evaluateAutomationRule(
          rule,
          { lesson: { ...lesson, paymentStatus } },
          data,
          now,
        ).suppressedReason,
      ).toBe("condition_resolved");
    data.packages = [
      {
        id: "package",
        studentId: lesson.studentId,
        name: "Credits",
        autoApply: true,
        priceMinor: 0,
        currency: "USD",
        version: 1,
        updatedAt: "",
      },
    ];
    data.creditEntries = [
      {
        id: "credit",
        packageId: "package",
        quantity: 1,
        kind: "purchase",
        reason: "Purchased",
        createdAt: "",
      },
    ];
    expect(
      evaluateAutomationRule(rule, { lesson }, data, now).suppressedReason,
    ).toBe("condition_resolved");
  });
  it("does not schedule stale reminders after cancellation or lesson start", () => {
    const { data, lesson } = fixture();
    expect(
      evaluateAutomationRule(
        rule,
        { lesson: { ...lesson, status: "cancelled" } },
        data,
        now,
      ).suppressedReason,
    ).toBe("lesson_not_scheduled");
    expect(
      evaluateAutomationRule(
        rule,
        { lesson },
        data,
        Date.parse(lesson.startsAt) + 60_000,
      ).suppressedReason,
    ).toBe("lesson_started");
  });
  it("adds a coach escalation only when explicitly configured", () => {
    const { data, lesson } = fixture();
    expect(
      evaluateAutomationRule(
        {
          ...rule,
          mode: "automatic_with_escalation",
          escalation: { coach: true, hoursBefore: 1 },
        },
        { lesson },
        data,
        now,
      ).stages,
    ).toContainEqual(
      expect.objectContaining({
        key: "coach-escalation",
        coachEscalation: true,
      }),
    );
    expect(
      evaluateAutomationRule(rule, { lesson }, data, now).stages.some(
        (stage) => stage.coachEscalation,
      ),
    ).toBe(false);
  });
  it("does not generate recursive delivery-failure alerts", () => {
    const { data } = fixture();
    const message = {
      id: "message",
      channel: "email" as const,
      recipient: "fixture@example.test",
      subject: "Failure",
      body: "Failure",
      status: "failed" as const,
      attempts: 1,
      version: 1,
      updatedAt: "",
      eventKey: "automation.delivery_failure",
    };
    expect(
      evaluateAutomationRule(
        { ...rule, key: "delivery_failure", audience: "coach" },
        { message },
        data,
        now,
      ).eligible,
    ).toBe(false);
    expect(
      evaluateAutomationRule(
        { ...rule, key: "delivery_failure", audience: "coach" },
        { message: { ...message, eventKey: "booking.reminder.student" } },
        data,
        now,
      ).eligible,
    ).toBe(true);
  });
});
