import type {
  CreditApplicationResult,
  CreditCoverageReason,
} from "./creditCoverage";

export const creditCoverageReasons: Record<CreditCoverageReason, string> = {
  eligible: "Available credit can cover this lesson",
  already_reserved: "Credit reserved",
  no_available_credits: "No available lesson credits",
  expires_before_lesson: "Credits expire before this lesson",
  cash_paid: "Already paid or otherwise settled",
  partially_paid: "Partially paid — review the remaining balance",
  payment_pending: "Online payment is pending",
  reconciliation_required: "Credit history needs coach review",
  auto_disabled: "Automatic use is off",
  mixed_settings_review: "Mixed package settings need coach review",
  lesson_ineligible: "This lesson is not eligible for a credit",
};

export function creditApplicationMessage(result: CreditApplicationResult) {
  return `${result.applied} newly covered · ${result.alreadyCovered} already covered · ${result.skipped} skipped · ${result.failed} failed.${result.autoApplyPending ? " Coverage recovery is pending." : ""}`;
}
