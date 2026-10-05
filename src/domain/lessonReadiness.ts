import { creditBalance } from "./finance";
import type { Lesson, StudioSnapshot } from "./model";
import {
  bookingForLesson,
  forecastPackages,
  packageApplies,
  reservedForLesson,
} from "./packageForecast";
import { paymentResponsibility } from "./paymentResponsibility";

export type LessonReadinessState = "ready" | "needs_attention" | "blocked";
export type LessonCoverageState =
  | "covered_paid"
  | "covered_package"
  | "covered_waived"
  | "payment_processing"
  | "payment_due"
  | "partially_paid"
  | "past_due"
  | "unknown"
  | "review_required";
export type CommunicationState =
  "sent" | "scheduled" | "missing" | "not_required";
export interface ReadinessIssue {
  code: string;
  severity: "info" | "warning" | "blocking";
  title: string;
  explanation: string;
  suggestedAction?: string;
}
export interface LessonReadiness {
  active: boolean;
  state: LessonReadinessState;
  financial: {
    state: LessonCoverageState;
    amountDueMinor: number;
    payerContactId?: string;
    payerName?: string;
    packageId?: string;
    currentPackageCredits?: number;
    projectedPackageCredits?: number;
    reason: string;
  };
  preparation: {
    planned: boolean;
    setupReady: boolean;
    materialsReady: boolean;
  };
  communication: {
    confirmationState: CommunicationState;
    reminderState: CommunicationState;
    nextMessageAt?: string;
  };
  logistics: { calendarReady: boolean | "unknown"; meetingReady: boolean };
  issues: ReadinessIssue[];
}
export type ReadinessData = Pick<
  StudioSnapshot,
  | "students"
  | "lessons"
  | "bookings"
  | "lessonParticipants"
  | "packages"
  | "packageDefinitions"
  | "creditEntries"
  | "payments"
  | "studentPricingRules"
  | "linkedContacts"
  | "outbox"
  | "settings"
>;

function communicationState(
  messages: ReadinessData["outbox"],
  required: boolean,
): CommunicationState {
  if (!required) return "not_required";
  if (messages.some((message) => message.status === "sent")) return "sent";
  if (
    messages.some((message) =>
      ["queued", "approved", "sending"].includes(message.status),
    )
  )
    return "scheduled";
  return "missing";
}

/** Deterministic operational read model. Never changes a ledger or infers money from a message. */
export function evaluateLessonReadiness(
  lesson: Lesson,
  data: ReadinessData,
  now: number,
): LessonReadiness {
  const student = data.students.find((item) => item.id === lesson.studentId);
  const payer = student
    ? paymentResponsibility(student, data.linkedContacts)
    : undefined;
  const booking = bookingForLesson(lesson, data);
  const active = lesson.status === "scheduled";
  const preparation = lesson.preparation ?? {
    planned: false,
    setupReady: false,
    materialsReady: false,
  };
  const financial: LessonReadiness["financial"] = {
    state: "unknown",
    amountDueMinor: 0,
    payerContactId: payer?.contactId,
    payerName: payer?.name,
    reason: "Financial coverage has not been recorded.",
  };
  const issues: ReadinessIssue[] = [];
  const price = booking?.totalMinor ?? lesson.priceMinor;
  const paid = booking?.paidMinor ?? lesson.paidMinor ?? 0;
  const paymentStatus = booking?.paymentStatus ?? lesson.paymentStatus;
  const pkg = data.packages.find((item) => item.id === lesson.packageId);
  const reserved =
    pkg && reservedForLesson(pkg.id, lesson.id, data.creditEntries);
  const forecast = forecastPackages(lesson.studentId, data, now);
  const projected = forecast.find(
    (item) =>
      item.eligibleLessonIds.includes(lesson.id) &&
      !item.uncoveredLessonIds.includes(lesson.id),
  );
  const forecastPkg =
    projected && data.packages.find((item) => item.id === projected.packageId);

  if (lesson.paymentStatus === "waived") {
    financial.state = "covered_waived";
    financial.reason = "Coach recorded a waiver or arrangement.";
  } else if (paymentStatus === "paid") {
    financial.state = "covered_paid";
    financial.reason = "Payment is recorded as paid.";
  } else if (paymentStatus === "not_required") {
    financial.state = "covered_waived";
    financial.reason = "This booking does not require payment.";
  } else if (
    reserved &&
    pkg &&
    packageApplies(
      pkg,
      data.packageDefinitions.find((item) => item.id === pkg.definitionId),
      lesson,
    )
  ) {
    financial.state = "covered_package";
    financial.packageId = pkg.id;
    financial.reason = "A ledger credit is already reserved for this lesson.";
  } else if (paymentStatus === "paid_by_credit" || reserved) {
    financial.state = "review_required";
    financial.reason =
      "The credit designation and applicable package ledger need reconciliation.";
  } else if (paymentStatus === "processing") {
    financial.state = "payment_processing";
    financial.reason = "Payment processing has not yet completed.";
  } else if (paymentStatus === "refunded" || paymentStatus === "failed") {
    financial.state = "review_required";
    financial.reason =
      paymentStatus === "failed"
        ? "The payment failed; review the recorded balance."
        : "The payment was refunded; review the arrangement.";
  } else if (paymentStatus === "partially_paid") {
    financial.state = "partially_paid";
    financial.reason = "Only part of the required payment is recorded.";
  } else if (forecastPkg) {
    financial.state = "covered_package";
    financial.packageId = forecastPkg.id;
    financial.reason =
      "An eligible auto-apply package has projected coverage; the ledger has not been changed.";
  } else if (["due", "past_due"].includes(paymentStatus ?? "")) {
    financial.state =
      paymentStatus === "past_due" ||
      (booking?.balanceDueAt && Date.parse(booking.balanceDueAt) <= now)
        ? "past_due"
        : "payment_due";
    financial.reason =
      financial.state === "past_due"
        ? "The recorded balance is past its due time."
        : "Payment is still required.";
  }
  if (
    !["covered_paid", "covered_package", "covered_waived"].includes(
      financial.state,
    ) &&
    price != null
  ) {
    financial.amountDueMinor = Math.max(0, price - paid);
  }
  if (financial.packageId) {
    financial.currentPackageCredits = creditBalance(
      financial.packageId,
      data.creditEntries,
    );
    financial.projectedPackageCredits = forecast.find(
      (item) => item.packageId === financial.packageId,
    )?.projectedCredits;
  }

  const messages = data.outbox.filter(
    (message) => message.lessonId === lesson.id,
  );
  const confirmationRequired = Boolean(
    active &&
    booking &&
    data.settings.emailAutomations.enabled &&
    data.settings.emailAutomations.studentConfirmation,
  );
  const reminderRequired = Boolean(
    active &&
    data.settings.emailAutomations.enabled &&
    data.settings.emailAutomations.reminders,
  );
  const confirmationState = communicationState(
    messages.filter((message) => /confirmation/.test(message.eventKey ?? "")),
    confirmationRequired,
  );
  const reminderState = communicationState(
    messages.filter(
      (message) =>
        /reminder/.test(message.eventKey ?? "") &&
        !/payment/.test(message.eventKey ?? ""),
    ),
    reminderRequired,
  );
  const nextMessageAt = messages
    .filter((message) => message.status === "queued" && message.sendAt)
    .map((message) => message.sendAt!)
    .sort()[0];
  const logistics: LessonReadiness["logistics"] = {
    calendarReady:
      lesson.sourceProvider === "google_calendar" && lesson.sourceExternalId
        ? true
        : "unknown",
    meetingReady:
      active &&
      (lesson.locationType === "in_person" ||
        lesson.meetingProvider === "in_person" ||
        Boolean(lesson.joinUrl?.trim())),
  };
  if (active) {
    if (financial.state === "unknown" || financial.state === "review_required")
      issues.push({
        code: "FINANCIAL_REVIEW_REQUIRED",
        severity: "blocking",
        title: "Review financial setup",
        explanation: financial.reason,
        suggestedAction: "open_finance",
      });
    else if (
      ["payment_due", "partially_paid", "past_due"].includes(financial.state)
    )
      issues.push({
        code: "PAYMENT_REQUIRED",
        severity: "warning",
        title: "Payment needs attention",
        explanation: financial.reason,
        suggestedAction: "open_finance",
      });
    else if (financial.state === "payment_processing")
      issues.push({
        code: "PAYMENT_PROCESSING",
        severity: "info",
        title: "Payment processing",
        explanation: financial.reason,
      });
    if (payer?.needsConfiguration || !payer)
      issues.push({
        code: "PAYER_CONFIGURATION_REQUIRED",
        severity: payer?.email ? "warning" : "blocking",
        title: "Confirm the payer",
        explanation: payer?.reason ?? "Student record is unavailable.",
        suggestedAction: "open_account",
      });
    if (
      !preparation.planned ||
      !preparation.setupReady ||
      !preparation.materialsReady
    )
      issues.push({
        code: "PREPARATION_INCOMPLETE",
        severity: "warning",
        title: "Finish lesson preparation",
        explanation: "Confirm the plan, setup, and materials for this lesson.",
        suggestedAction: "prepare_lesson",
      });
    if (confirmationState === "missing" || reminderState === "missing")
      issues.push({
        code: "COMMUNICATION_MISSING",
        severity: "warning",
        title: "Review scheduled communication",
        explanation:
          "An expected confirmation or reminder is not sent or queued.",
        suggestedAction: "open_communications",
      });
    if (!logistics.meetingReady)
      issues.push({
        code: "MEETING_NOT_READY",
        severity:
          Date.parse(lesson.startsAt) - now <= 30 * 60_000
            ? "blocking"
            : "warning",
        title: "Meeting details pending",
        explanation: "The virtual lesson has no available meeting link.",
        suggestedAction: "open_lesson",
      });
    for (const item of forecast) {
      if (item.firstUncoveredLessonId === lesson.id)
        issues.push({
          code: item.expiresBeforeLessonIds.includes(lesson.id)
            ? "PACKAGE_EXPIRES_BEFORE_LESSON"
            : "PACKAGE_COVERAGE_SHORTFALL",
          severity: "warning",
          title: "Package coverage needs review",
          explanation:
            "The current package will not cover this scheduled lesson.",
          suggestedAction: "open_finance",
        });
    }
  }
  return {
    active,
    state: issues.some((issue) => issue.severity === "blocking")
      ? "blocked"
      : issues.some((issue) => issue.severity === "warning")
        ? "needs_attention"
        : "ready",
    financial,
    preparation,
    communication: { confirmationState, reminderState, nextMessageAt },
    logistics,
    issues,
  };
}
