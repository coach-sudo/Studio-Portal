import { describe, expect, it } from "vitest";
import { demoSnapshot } from "../data/demo";
import type {
  Booking,
  CreditEntry,
  Lesson,
  LinkedContact,
  PackageAccount,
  StudioSnapshot,
} from "./model";
import { evaluateLessonReadiness } from "./lessonReadiness";
import { forecastPackages } from "./packageForecast";
import { paymentResponsibility } from "./paymentResponsibility";

const now = Date.parse("2026-10-04T12:00:00Z");
const lesson: Lesson = {
  id: "lesson",
  studioId: "studio",
  studentId: "student",
  version: 1,
  updatedAt: "",
  topic: "Coaching",
  startsAt: "2026-10-05T12:00:00Z",
  endsAt: "2026-10-05T13:00:00Z",
  status: "scheduled",
  locationType: "virtual",
  locationLabel: "Google Meet",
  joinUrl: "https://meet.google.com/example",
  paymentStatus: "paid",
  priceMinor: 8500,
  paidMinor: 8500,
  preparation: { planned: true, setupReady: true, materialsReady: true },
};
const pkg: PackageAccount = {
  id: "package",
  studentId: "student",
  version: 1,
  updatedAt: "",
  name: "Studio credits",
  priceMinor: 0,
  currency: "USD",
  autoApply: true,
};
const credit: CreditEntry = {
  id: "credit",
  packageId: "package",
  kind: "purchase",
  quantity: 3,
  reason: "Purchased",
  createdAt: "",
};
function fixture(): StudioSnapshot {
  const data = structuredClone(demoSnapshot);
  data.students = [
    {
      ...data.students[0],
      id: "student",
      isMinor: false,
      email: "student@example.test",
    },
  ];
  data.lessons = [{ ...lesson }];
  data.linkedContacts = [];
  data.packages = [];
  data.packageDefinitions = [];
  data.creditEntries = [];
  data.bookings = [];
  data.lessonParticipants = [];
  data.payments = [];
  data.outbox = [];
  data.settings.emailAutomations.reminders = false;
  return data;
}
function evaluate(data: StudioSnapshot) {
  return evaluateLessonReadiness(data.lessons[0], data, now);
}
function booking(status: Booking["paymentStatus"]): Booking {
  return {
    ...demoSnapshot.bookings[0],
    id: "booking",
    studentId: "student",
    startsAt: lesson.startsAt,
    endsAt: lesson.endsAt,
    paymentStatus: status,
    totalMinor: 8500,
    paidMinor: status === "paid" ? 8500 : 0,
  };
}
function contact(overrides: Partial<LinkedContact> = {}): LinkedContact {
  return {
    id: "contact",
    studentId: "student",
    studioId: "studio",
    fullName: "Melissa",
    email: "MELISSA@example.test",
    version: 1,
    updatedAt: "",
    relationshipType: "guardian",
    canViewSchedule: true,
    canManageLessons: false,
    canViewWork: false,
    canManageProfile: false,
    canViewFinance: true,
    canReceiveNotifications: true,
    portalEnabled: true,
    notificationPreferences: {
      lessonReminders: true,
      scheduleChanges: true,
      lessonContent: false,
      assignments: false,
      packageBalance: true,
      payments: true,
      accountAccess: true,
    },
    ...overrides,
  };
}

describe("deterministic lesson readiness", () => {
  it("classifies a prepared paid PAYG lesson as ready", () => {
    expect(evaluate(fixture())).toMatchObject({
      state: "ready",
      financial: { state: "covered_paid", amountDueMinor: 0 },
    });
  });
  it("does not count unrelated account payments as lesson payments", () => {
    const data = fixture();
    data.lessons[0].paymentStatus = "due";
    data.lessons[0].paidMinor = 0;
    data.payments = [
      {
        id: "unrelated",
        studentId: "student",
        kind: "payment",
        amountMinor: 8500,
        currency: "USD",
        createdAt: "",
        reason: "Other lesson",
      },
    ];
    expect(evaluate(data).financial).toMatchObject({
      state: "payment_due",
      amountDueMinor: 8500,
    });
  });
  it("computes a partially paid lesson's remaining amount", () => {
    const data = fixture();
    Object.assign(data.lessons[0], {
      paymentStatus: "partially_paid",
      paidMinor: 3000,
    });
    expect(evaluate(data).financial).toMatchObject({
      state: "partially_paid",
      amountDueMinor: 5500,
    });
  });
  it("uses the booking's processing state instead of the lesson's stale paid state", () => {
    const data = fixture();
    data.bookings = [booking("processing")];
    expect(evaluate(data).financial.state).toBe("payment_processing");
  });
  it("honors a recorded waiver without erasing the payment record", () => {
    const data = fixture();
    data.bookings = [booking("due")];
    data.lessons[0].paymentStatus = "waived";
    expect(evaluate(data).financial).toMatchObject({
      state: "covered_waived",
      amountDueMinor: 0,
    });
  });
  it("requires review for refunded or failed payments", () => {
    for (const status of ["refunded", "failed"] as const) {
      const data = fixture();
      data.bookings = [booking(status)];
      expect(evaluate(data).financial.state).toBe("review_required");
    }
  });
  it("shows past due from the explicit booking due time", () => {
    const data = fixture();
    data.bookings = [
      { ...booking("due"), balanceDueAt: "2026-10-03T12:00:00Z" },
    ];
    expect(evaluate(data).financial.state).toBe("past_due");
  });
  it("does not infer payment from sent emails", () => {
    const data = fixture();
    Object.assign(data.lessons[0], {
      paymentStatus: "untracked",
      priceMinor: undefined,
      paidMinor: 0,
    });
    data.outbox = [
      {
        id: "message",
        lessonId: "lesson",
        studentId: "student",
        channel: "email",
        recipient: "student@example.test",
        subject: "Paid",
        body: "Paid",
        status: "sent",
        eventKey: "payment.receipt",
        attempts: 1,
        version: 1,
        updatedAt: "",
      },
    ];
    expect(evaluate(data)).toMatchObject({
      state: "blocked",
      financial: { state: "unknown" },
    });
  });
  it("provides the linked payer for a minor", () => {
    const data = fixture();
    data.students[0].isMinor = true;
    data.linkedContacts = [contact({ isPrimaryPayer: true })];
    expect(evaluate(data).financial).toMatchObject({
      payerContactId: "contact",
      payerName: "Melissa",
    });
  });
  it("recognizes an adult self-payer", () => {
    expect(evaluate(fixture()).financial.payerName).toBe(
      fixture().students[0].fullName,
    );
  });
  it("flags a missing minor payer rather than emailing the child", () => {
    const data = fixture();
    data.students[0].isMinor = true;
    expect(evaluate(data).issues).toContainEqual(
      expect.objectContaining({
        code: "PAYER_CONFIGURATION_REQUIRED",
        severity: "blocking",
      }),
    );
    expect(paymentResponsibility(data.students[0], []).email).toBeUndefined();
  });
  it("chooses a stable authorized fallback and requires explicit configuration", () => {
    const data = fixture();
    data.students[0].isMinor = true;
    const result = paymentResponsibility(data.students[0], [
      contact({ id: "z" }),
      contact({ id: "a" }),
    ]);
    expect(result).toMatchObject({
      contactId: "a",
      source: "fallback",
      needsConfiguration: true,
    });
  });
  it("does not bypass a disabled primary payer by guessing another recipient", () => {
    const data = fixture();
    const result = paymentResponsibility(data.students[0], [
      contact({ isPrimaryPayer: true, canViewFinance: false }),
    ]);
    expect(result.source).toBe("unresolved");
    expect(result.email).toBeUndefined();
  });
  it("rejects contradictory primary designations in legacy/imported input", () => {
    const data = fixture();
    expect(
      paymentResponsibility(data.students[0], [
        contact({ isPrimaryPayer: true }),
        contact({ id: "other", isPrimaryPayer: true }),
      ]).source,
    ).toBe("unresolved");
  });
  it("shows a queued reminder and its next send time", () => {
    const data = fixture();
    data.settings.emailAutomations.reminders = true;
    data.outbox = [
      {
        id: "message",
        studentId: "student",
        lessonId: "lesson",
        channel: "email",
        recipient: "student@example.test",
        subject: "Reminder",
        body: "Lesson",
        status: "queued",
        eventKey: "booking.reminder.student",
        sendAt: "2026-10-05T10:00:00Z",
        attempts: 0,
        version: 1,
        updatedAt: "",
      },
    ];
    expect(evaluate(data).communication).toMatchObject({
      reminderState: "scheduled",
      nextMessageAt: "2026-10-05T10:00:00Z",
    });
  });
  it("does not mistake a payment reminder for a lesson reminder", () => {
    const data = fixture();
    data.settings.emailAutomations.reminders = true;
    data.outbox = [
      {
        id: "message",
        lessonId: "lesson",
        channel: "email",
        recipient: "student@example.test",
        subject: "Reminder",
        body: "Payment",
        status: "queued",
        eventKey: "payment.reminder",
        attempts: 0,
        version: 1,
        updatedAt: "",
      },
    ];
    expect(evaluate(data).communication.reminderState).toBe("missing");
  });
  it("reports missing required communication", () => {
    const data = fixture();
    data.settings.emailAutomations.reminders = true;
    expect(evaluate(data).issues.map((item) => item.code)).toContain(
      "COMMUNICATION_MISSING",
    );
  });
  it("reports meeting readiness without exposing an early meeting CTA", () => {
    const data = fixture();
    expect(evaluate(data).logistics.meetingReady).toBe(true);
    data.lessons[0].joinUrl = undefined;
    expect(
      evaluateLessonReadiness(
        data.lessons[0],
        data,
        Date.parse(lesson.startsAt) - 5 * 60_000,
      ),
    ).toMatchObject({ state: "blocked", logistics: { meetingReady: false } });
  });
  it("excludes canceled/completed lessons from active readiness exceptions", () => {
    for (const status of [
      "cancelled",
      "late_cancelled",
      "completed",
      "no_show",
    ] as const) {
      const data = fixture();
      Object.assign(data.lessons[0], {
        status,
        joinUrl: undefined,
        paymentStatus: "untracked",
      });
      expect(evaluate(data)).toMatchObject({
        active: false,
        state: "ready",
        issues: [],
      });
    }
  });
});

describe("package coverage projections", () => {
  function packages() {
    const data = fixture();
    data.packages = [{ ...pkg }];
    data.creditEntries = [{ ...credit }];
    Object.assign(data.lessons[0], { paymentStatus: "due", paidMinor: 0 });
    return data;
  }
  it("covers a lesson with applicable auto-apply credits without mutation", () => {
    const data = packages();
    const before = structuredClone(data);
    expect(evaluate(data).financial).toMatchObject({
      state: "covered_package",
      currentPackageCredits: 3,
      projectedPackageCredits: 2,
    });
    expect(data).toEqual(before);
  });
  it("does not cover lessons after package expiration", () => {
    const data = packages();
    data.packages[0].expiresAt = "2026-10-05T11:00:00Z";
    expect(evaluate(data).financial.state).toBe("payment_due");
    expect(
      forecastPackages("student", data, now)[0].expiresBeforeLessonIds,
    ).toEqual(["lesson"]);
  });
  it("does not cover a lesson with zero credits", () => {
    const data = packages();
    data.creditEntries[0].quantity = 0;
    expect(evaluate(data).financial.state).toBe("payment_due");
  });
  it("forecasts the first uncovered lesson and negative balance", () => {
    const data = packages();
    data.lessons = Array.from({ length: 5 }, (_, i) => ({
      ...data.lessons[0],
      id: `lesson-${i}`,
      startsAt: `2026-10-${String(5 + i).padStart(2, "0")}T12:00:00Z`,
      endsAt: `2026-10-${String(5 + i).padStart(2, "0")}T13:00:00Z`,
    }));
    expect(forecastPackages("student", data, now)[0]).toMatchObject({
      currentCredits: 3,
      expectedConsumption: 5,
      projectedCredits: -2,
      firstUncoveredLessonId: "lesson-3",
      uncoveredLessonIds: ["lesson-3", "lesson-4"],
    });
    expect(
      evaluateLessonReadiness(data.lessons[4], data, now).financial.state,
    ).toBe("payment_due");
  });
  it("does not double count an existing reservation even with zero available balance", () => {
    const data = packages();
    data.creditEntries[0].quantity = 1;
    data.lessons[0].packageId = pkg.id;
    data.creditEntries.push({
      ...credit,
      id: "reservation",
      lessonId: "lesson",
      kind: "reservation",
      quantity: -1,
    });
    expect(forecastPackages("student", data, now)[0]).toMatchObject({
      currentCredits: 0,
      expectedConsumption: 0,
      projectedCredits: 0,
      reservedLessonIds: ["lesson"],
    });
    expect(evaluate(data).financial.state).toBe("covered_package");
  });
  it("does not treat released reservations as coverage", () => {
    const data = packages();
    data.lessons[0].packageId = pkg.id;
    data.packages[0].autoApply = false;
    data.creditEntries.push(
      {
        ...credit,
        id: "reservation",
        lessonId: "lesson",
        kind: "reservation",
        quantity: -1,
      },
      {
        ...credit,
        id: "release",
        lessonId: "lesson",
        kind: "release",
        quantity: 1,
      },
    );
    data.lessons[0].paymentStatus = "paid_by_credit";
    expect(evaluate(data).financial.state).toBe("review_required");
  });
  it("does not auto-apply a disabled package", () => {
    const data = packages();
    data.packages[0].autoApply = false;
    expect(evaluate(data).financial.state).toBe("payment_due");
  });
  it("covers any service and duration with a usable lesson credit", () => {
    const data = packages();
    data.packages[0].definitionId = "definition";
    data.packageDefinitions = [
      {
        ...demoSnapshot.packageDefinitions[0],
        id: "definition",
        active: true,
        eligibleServiceIds: ["different-service"],
        sessionDurationMinutes: 60,
        meetingProviders: ["google_meet"],
      },
    ];
    expect(evaluate(data).financial.state).toBe("covered_package");
    data.lessons[0].serviceId = "different-service";
    expect(evaluate(data).financial.state).toBe("covered_package");
    data.packageDefinitions[0].sessionDurationMinutes = 30;
    expect(evaluate(data).financial.state).toBe("covered_package");
  });
  it("allocates across packages once, in expiry order", () => {
    const data = packages();
    data.creditEntries[0].quantity = 1;
    data.packages.push({ ...pkg, id: "second" });
    data.creditEntries.push({
      ...credit,
      id: "second-credit",
      packageId: "second",
      quantity: 1,
    });
    data.lessons.push({
      ...data.lessons[0],
      id: "next",
      startsAt: "2026-10-06T12:00:00Z",
      endsAt: "2026-10-06T13:00:00Z",
    });
    expect(
      forecastPackages("student", data, now).map(
        (item) => item.projectedCredits,
      ),
    ).toEqual([0, 0]);
  });
});
