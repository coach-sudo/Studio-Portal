import type { LessonCoverageState } from "../../domain/lessonReadiness";

export const coverageLabels: Record<LessonCoverageState, string> = {
  covered_paid: "Paid",
  covered_package: "Package covered",
  covered_waived: "Waived / arranged",
  payment_processing: "Payment processing",
  payment_due: "Payment due",
  partially_paid: "Partially paid",
  past_due: "Past due",
  unknown: "Financial setup unknown",
  review_required: "Financial review required",
};
