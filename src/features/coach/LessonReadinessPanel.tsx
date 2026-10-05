import { Link } from "react-router-dom";
import { Status } from "../../components/Primitives";
import { formatMoney } from "../../domain/finance";
import {
  evaluateLessonReadiness,
  type ReadinessData,
  type LessonCoverageState,
} from "../../domain/lessonReadiness";
import type { Lesson } from "../../domain/model";
import { formatStudioDateTime } from "../../domain/presentation";
import "./operational-intelligence.css";

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

export function LessonReadinessPanel({
  lesson,
  data,
  now = Date.now(),
}: {
  lesson: Lesson;
  data: ReadinessData;
  now?: number;
}) {
  const readiness = evaluateLessonReadiness(lesson, data, now);
  if (!readiness.active) return null;
  const financial = readiness.financial;
  const prepared = Object.values(readiness.preparation).every(Boolean);
  return (
    <details
      className="lesson-readiness"
      data-testid={`readiness-${lesson.id}`}
    >
      <summary>
        <Status
          tone={
            readiness.state === "ready"
              ? "good"
              : readiness.state === "blocked"
                ? "danger"
                : "warn"
          }
        >
          {readiness.state === "ready"
            ? "Ready"
            : readiness.state === "blocked"
              ? "Blocked"
              : "Needs attention"}
        </Status>
        <span>
          {coverageLabels[financial.state]}
          {financial.amountDueMinor > 0
            ? ` · ${formatMoney(financial.amountDueMinor, data.settings.currency)} due`
            : ""}
        </span>
      </summary>
      <dl className="detail-grid">
        <div>
          <dt>Preparation</dt>
          <dd>
            {prepared ? "Ready" : "Needs preparation"} · Plan{" "}
            {readiness.preparation.planned ? "✓" : "pending"} · Setup{" "}
            {readiness.preparation.setupReady ? "✓" : "pending"} · Materials{" "}
            {readiness.preparation.materialsReady ? "✓" : "pending"}
          </dd>
        </div>
        <div>
          <dt>Financial coverage</dt>
          <dd>{financial.reason}</dd>
        </div>
        <div>
          <dt>Payer</dt>
          <dd>{financial.payerName || "Not configured"}</dd>
        </div>
        <div>
          <dt>Confirmation / reminder</dt>
          <dd>
            {readiness.communication.confirmationState.replaceAll("_", " ")} /{" "}
            {readiness.communication.reminderState.replaceAll("_", " ")}
          </dd>
        </div>
        <div>
          <dt>Next communication</dt>
          <dd>
            {readiness.communication.nextMessageAt
              ? formatStudioDateTime(
                  readiness.communication.nextMessageAt,
                  data.settings.timezone,
                )
              : "None queued"}
          </dd>
        </div>
        <div>
          <dt>Calendar / meeting</dt>
          <dd>
            {readiness.logistics.calendarReady === "unknown"
              ? "Calendar status not verified"
              : "Calendar ready"}{" "}
            ·{" "}
            {readiness.logistics.meetingReady
              ? "Meeting ready"
              : "Meeting pending"}
          </dd>
        </div>
        {financial.packageId && (
          <div>
            <dt>Package credits</dt>
            <dd>
              {financial.currentPackageCredits} available ·{" "}
              {financial.projectedPackageCredits} projected after scheduled
              lessons
            </dd>
          </div>
        )}
      </dl>
      {readiness.issues.length > 0 && (
        <ul>
          {readiness.issues.map((issue) => (
            <li key={issue.code}>
              <strong>{issue.title}</strong> — {issue.explanation}
            </li>
          ))}
        </ul>
      )}
      <div className="form-actions">
        <Link
          className="button-link"
          to={`/coach/students/${lesson.studentId}/lessons/${lesson.id}`}
        >
          Open lesson
        </Link>
        <Link
          className="button-link"
          to={`/coach/students/${lesson.studentId}/payments`}
        >
          Review finance / arrangement
        </Link>
        <Link
          className="button-link"
          to={`/coach/students/${lesson.studentId}/account`}
        >
          Payer & communication
        </Link>
      </div>
    </details>
  );
}
