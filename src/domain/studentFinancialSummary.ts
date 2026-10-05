import type { ReadinessData } from "./lessonReadiness";
import { evaluateLessonReadiness } from "./lessonReadiness";
import { bookingForLesson, forecastPackages } from "./packageForecast";
import { paymentResponsibility } from "./paymentResponsibility";
import type { Student } from "./model";

/** Booking balances are counted once even when a series maps several lessons to one booking. */
export function studentFinancialSummary(
  student: Student,
  data: ReadinessData,
  now: number,
) {
  const upcoming = data.lessons
    .filter(
      (lesson) =>
        lesson.studentId === student.id &&
        lesson.status === "scheduled" &&
        Date.parse(lesson.endsAt) > now,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const next = upcoming[0];
  const counted = new Set<string>();
  let outstandingMinor = 0,
    requiresReconciliation = false;
  for (const lesson of data.lessons.filter(
    (lesson) =>
      lesson.studentId === student.id &&
      !["cancelled", "late_cancelled", "draft"].includes(lesson.status),
  )) {
    const readiness = evaluateLessonReadiness(lesson, data, now),
      booking = bookingForLesson(lesson, data),
      key = booking ? `booking:${booking.id}` : `lesson:${lesson.id}`;
    requiresReconciliation ||= ["unknown", "review_required"].includes(
      readiness.financial.state,
    );
    if (!counted.has(key)) {
      counted.add(key);
      outstandingMinor += readiness.financial.amountDueMinor;
    }
  }
  const currentRate =
    data.studentPricingRules
      .filter(
        (rule) =>
          rule.studentId === student.id &&
          rule.active &&
          !rule.serviceId &&
          (!rule.startsAt || Date.parse(rule.startsAt) <= now) &&
          (!rule.endsAt || Date.parse(rule.endsAt) > now),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.priceMinor ??
    student.defaultRateMinor;
  return {
    payer: paymentResponsibility(student, data.linkedContacts),
    upcoming,
    next: next
      ? { lesson: next, readiness: evaluateLessonReadiness(next, data, now) }
      : undefined,
    nextPaymentDueAt: next
      ? bookingForLesson(next, data)?.balanceDueAt
      : undefined,
    forecasts: forecastPackages(student.id, data, now),
    currentRate,
    outstandingMinor,
    requiresReconciliation,
  };
}
