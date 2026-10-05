import { describe, expect, it } from "vitest";
import { demoSnapshot } from "../data/demo";
import type { LinkedContact } from "./model";
import { resolveNotificationRecipients } from "./notificationRecipients";

const student = {
  ...demoSnapshot.students[0],
  id: "student",
  email: "student@example.test",
  isMinor: true,
};
const contact: LinkedContact = {
  id: "payer",
  studioId: "studio",
  studentId: "student",
  fullName: "Payer",
  email: "PAYER@example.test",
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
  isPrimaryPayer: true,
  notificationPreferences: {
    payments: true,
    packageBalance: true,
    lessonContent: true,
    assignments: true,
    lessonReminders: true,
    scheduleChanges: true,
    accountAccess: true,
  },
};

describe("event-aware notification recipients", () => {
  it("directs payment requests to the minor's payer, never the minor", () => {
    const result = resolveNotificationRecipients(
      student,
      [contact],
      "payment_due",
    );
    expect(result.recipients).toEqual([
      {
        email: "payer@example.test",
        source: "linked_contact",
        linkedContactId: "payer",
        reason: "Primary payer",
      },
    ]);
    expect(result.suppressed).toContainEqual(
      expect.objectContaining({
        source: "student",
        reason: expect.stringContaining("minor"),
      }),
    );
  });
  it("permits adult self payment without a primary contact", () => {
    expect(
      resolveNotificationRecipients(
        { ...student, isMinor: false },
        [],
        "payment_due",
      ).recipients[0].email,
    ).toBe("student@example.test");
  });
  it("does not let finance permission grant private work access", () => {
    const result = resolveNotificationRecipients(
      student,
      [contact],
      "lesson_content",
    );
    expect(result.recipients.map((item) => item.email)).toEqual([
      "student@example.test",
    ]);
    expect(result.suppressed).toContainEqual(
      expect.objectContaining({
        linkedContactId: "payer",
        reason: "Work access not permitted.",
      }),
    );
  });
  it("honors payer preferences without redirecting to another person", () => {
    const result = resolveNotificationRecipients(
      student,
      [
        {
          ...contact,
          notificationPreferences: {
            ...contact.notificationPreferences,
            payments: false,
          },
        },
      ],
      "payment_due",
    );
    expect(result.recipients).toHaveLength(0);
    expect(result.suppressed).toContainEqual(
      expect.objectContaining({
        reason: "Notification preference disabled: payments.",
      }),
    );
  });
  it("mandatory communication still cannot bypass work access", () => {
    expect(
      resolveNotificationRecipients(student, [contact], "assignment", {
        mandatory: true,
      }).recipients,
    ).toHaveLength(1);
  });
  it("schedules to the student and designated scheduling contact", () => {
    const scheduling = {
      ...contact,
      id: "scheduler",
      email: "scheduler@example.test",
      isPrimaryPayer: false,
      isPrimarySchedulingContact: true,
      canViewFinance: false,
    };
    expect(
      resolveNotificationRecipients(
        student,
        [contact, scheduling],
        "lesson_reminder",
      ).recipients.map((item) => item.email),
    ).toEqual(["student@example.test", "scheduler@example.test"]);
  });
  it("adds permitted financial escalation contacts only for past-due events", () => {
    const escalation = {
      ...contact,
      id: "escalation",
      email: "escalation@example.test",
      isPrimaryPayer: false,
      receivesFinancialEscalations: true,
    };
    expect(
      resolveNotificationRecipients(
        student,
        [contact, escalation],
        "payment_due",
      ).recipients,
    ).toHaveLength(1);
    expect(
      resolveNotificationRecipients(
        student,
        [contact, escalation],
        "payment_past_due",
      ).recipients,
    ).toHaveLength(2);
  });
  it("deduplicates normalized email addresses", () => {
    const result = resolveNotificationRecipients(
      student,
      [{ ...contact, email: " STUDENT@example.test ", canViewWork: true }],
      "lesson_content",
    );
    expect(result.recipients).toHaveLength(1);
    expect(result.suppressed).toContainEqual(
      expect.objectContaining({ reason: "Duplicate normalized address." }),
    );
  });
  it("reports missing payer configuration instead of guessing guardian_email", () => {
    const result = resolveNotificationRecipients(
      { ...student, guardianEmail: "unknown@example.test" },
      [],
      "payment_failed",
    );
    expect(result.recipients).toHaveLength(0);
    expect(result.unresolved.join(" ")).toContain("linked payer");
  });
  it("revalidates revoked permission and disabled access", () => {
    for (const change of [
      { canViewFinance: false },
      { portalEnabled: false },
      { canReceiveNotifications: false },
    ]) {
      expect(
        resolveNotificationRecipients(
          student,
          [{ ...contact, ...change }],
          "payment_due",
        ).recipients,
      ).toHaveLength(0);
    }
  });
});
