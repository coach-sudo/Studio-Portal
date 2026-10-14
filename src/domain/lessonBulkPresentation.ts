import { lessonChangeReasons } from "./lessonChanges";
import type { LessonBulkOperation } from "./lessonBulk";

export const lessonBulkLabels: Record<LessonBulkOperation, string> = {
  cancel: "Cancel lessons",
  archive: "Archive lessons",
  restore: "Restore archived lessons",
  void: "Void erroneous records",
  delete: "Permanently delete lessons",
};
const reasons: Record<string, string> = {
  ...lessonChangeReasons,
  terminal_record_required:
    "Only completed or cancelled lessons can be archived.",
  already_archived: "Already archived.",
  not_archived: "This lesson is not archived.",
  cancelled_record_required: "Cancel the erroneous record before voiding it.",
  record_voided: "This record has already been voided.",
  historical_record_protected:
    "Completed and late-cancelled history cannot be deleted.",
  provider_history: "Provider or import history must be preserved.",
  credit_history: "Package or credit ledger history must be preserved.",
  financial_history: "Payment or invoice history must be preserved.",
  financial_review_required:
    "Resolve the financial obligation before voiding this record.",
  class_history: "Class and offering records cannot be permanently deleted.",
  participant_history: "Participation history must be preserved.",
  calendar_history: "Calendar synchronization has already been attempted.",
  record_dependencies:
    "Linked records must be preserved; see the dependencies below.",
  record_management_history:
    "Previous record management history must be preserved.",
  dependencies_changed:
    "The record changed after review. Review its current state again.",
  lesson_unavailable: "This lesson is unavailable.",
  worker_lease_exhausted:
    "Processing was interrupted repeatedly. You can retry this failed item.",
};
export function lessonBulkReason(code: string | null) {
  if (!code) return "";
  return (
    reasons[code] ||
    (code.startsWith("execution_failed_")
      ? "The operation failed and was rolled back. Retry failed items or review the record."
      : `Review required (${code.replaceAll("_", " ")}).`)
  );
}
