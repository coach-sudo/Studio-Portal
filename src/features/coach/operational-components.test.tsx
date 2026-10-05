import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { demoSnapshot } from "../../data/demo";
import { LessonReadinessPanel } from "./LessonReadinessPanel";
import { StudentFinancialSetup } from "./StudentFinancialSetup";
import { AutomationRuleCard } from "./automation/AutomationRuleCard";
import { AutomationRuleEditor } from "./automation/AutomationRuleEditor";
import { demoRules } from "./automation/demoRules";
const now = Date.parse("2026-10-05T12:00:00Z");
function fixture() {
  const data = structuredClone(demoSnapshot);
  data.students = [
    {
      ...data.students[0],
      id: "student",
      fullName: "Jordan",
      isMinor: false,
      email: "jordan@example.test",
    },
  ];
  data.lessons = [
    {
      ...data.lessons[0],
      id: "lesson",
      studentId: "student",
      status: "scheduled",
      startsAt: "2026-10-06T12:00:00Z",
      endsAt: "2026-10-06T13:00:00Z",
      paymentStatus: "due",
      priceMinor: 8500,
      paidMinor: 0,
      packageId: undefined,
    },
  ];
  data.packages = [];
  data.creditEntries = [];
  data.bookings = [];
  data.lessonParticipants = [];
  data.linkedContacts = [];
  data.outbox = [];
  return data;
}
describe("operational coach component contracts", () => {
  it("shows compact financial, preparation, communication and meeting signals before expanding", () => {
    const data = fixture();
    render(
      <MemoryRouter>
        <LessonReadinessPanel lesson={data.lessons[0]} data={data} now={now} />
      </MemoryRouter>,
    );
    const summary = screen
      .getByTestId("readiness-lesson")
      .querySelector("summary")!;
    expect(summary).toHaveTextContent("Payment due");
    expect(summary).toHaveTextContent("Preparation");
    expect(summary).toHaveTextContent("Reminder");
    expect(summary).toHaveTextContent("Meeting");
    expect(
      screen.getByRole("link", {
        name: "Review finance / arrangement",
        hidden: true,
      }),
    ).toHaveAttribute("href", "/coach/students/student/payments");
  });
  it("excludes cancelled lessons from active readiness", () => {
    const data = fixture();
    data.lessons[0].status = "cancelled";
    const { container } = render(
      <MemoryRouter>
        <LessonReadinessPanel lesson={data.lessons[0]} data={data} now={now} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it("shows the deterministic balance and correct next-lesson state on financial setup", () => {
    const data = fixture();
    render(
      <MemoryRouter>
        <StudentFinancialSetup
          student={data.students[0]}
          data={data}
          now={now}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Financial setup" }),
    ).toBeVisible();
    expect(
      screen.getByText("Recorded outstanding balance").nextElementSibling,
    ).toHaveTextContent("$85.00");
    expect(
      screen.getByText("Next lesson").nextElementSibling,
    ).toHaveTextContent("Payment due");
    expect(
      screen.getByText("Primary payer").nextElementSibling,
    ).toHaveTextContent("Jordan");
  });
  it("describes past-due timing accurately and keeps irrelevant editor fields hidden", async () => {
    const rule = demoRules(fixture()).find(
      (item) => item.rule_key === "payment_past_due",
    )!;
    const { container } = render(
      <>
        <AutomationRuleCard rule={rule} onEdit={vi.fn()} onPreview={vi.fn()} />
        <AutomationRuleEditor
          edit={rule}
          busy={false}
          notice=""
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </>,
    );
    expect(
      screen.getByText("Once per lesson when a recorded balance is past due"),
    ).toBeVisible();
    expect(
      screen.getByLabelText("Hours before lesson (comma-separated)"),
    ).not.toBeVisible();
    expect(screen.getByLabelText("Expiration warning days")).not.toBeVisible();
    const results = await axe.run(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    expect(results.violations.map((item) => item.id)).toEqual([]);
  });
  it("preserves individual legacy switches while new rule families remain off", () => {
    const data = fixture();
    data.settings.emailAutomations.enabled = true;
    data.settings.emailAutomations.studentConfirmation = false;
    data.settings.emailAutomations.reminders = false;
    const rules = demoRules(data);
    expect(
      rules.find((item) => item.rule_key === "booking_confirmation")?.mode,
    ).toBe("off");
    expect(
      rules.find((item) => item.rule_key === "lesson_reminder")?.mode,
    ).toBe("off");
    expect(rules.find((item) => item.rule_key === "payment_due")?.mode).toBe(
      "off",
    );
    expect(rules.find((item) => item.rule_key === "payment_failed")?.mode).toBe(
      "automatic",
    );
  });
});
