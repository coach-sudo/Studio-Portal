import { Link } from "react-router-dom";
import { Section } from "../../components/Primitives";
import { formatMoney } from "../../domain/finance";
import type { ReadinessData } from "../../domain/lessonReadiness";
import type { Student } from "../../domain/model";
import { studentFinancialSummary } from "../../domain/studentFinancialSummary";
import { packageCoverageRecommendations } from "../../domain/packageRecommendations";
import { formatStudioDateTime } from "../../domain/presentation";
import { coverageLabels } from "./LessonReadinessPanel";
import "./operational-intelligence.css";

export function StudentFinancialSetup({
  data,
  student,
  now = Date.now(),
}: {
  data: ReadinessData;
  student: Student;
  now?: number;
}) {
  const {
    payer,
    upcoming,
    forecasts,
    currentRate,
    next,
    outstandingMinor,
    requiresReconciliation,
  } = studentFinancialSummary(student, data, now);
  return (
    <div className="financial-setup">
      <Section title="Financial setup" marked>
        {packageCoverageRecommendations(
          student.id,
          student.studioId,
          data,
          now,
        ).map((item) => (
          <p key={item.id} data-reason-code={item.reasonCode}>
            <strong>{item.title}:</strong> {item.explanation}
          </p>
        ))}
        <dl className="detail-grid">
          <div>
            <dt>Billing structure</dt>
            <dd>
              {forecasts.length
                ? "Package credits / PAYG as applicable"
                : "Pay as you go"}
            </dd>
          </div>
          <div>
            <dt>Primary payer</dt>
            <dd>
              {payer.name || "Not configured"}
              {payer.needsConfiguration ? " · Needs configuration" : ""}{" "}
              <Link to={`/coach/students/${student.id}/account`}>
                Manage responsibility
              </Link>
            </dd>
          </div>
          <div>
            <dt>Default rate</dt>
            <dd>
              {currentRate == null
                ? "Not configured"
                : formatMoney(currentRate, data.settings.currency)}
            </dd>
          </div>
          <div>
            <dt>Payment method</dt>
            <dd>
              {student.paymentMethodSummary ||
                "No saved payment method summary"}
            </dd>
          </div>
          <div>
            <dt>Recorded outstanding balance</dt>
            <dd>
              {formatMoney(outstandingMinor, data.settings.currency)}
              {requiresReconciliation
                ? " · Some lessons require reconciliation"
                : ""}
            </dd>
          </div>
          <div>
            <dt>Next lesson</dt>
            <dd>
              {next
                ? `${formatStudioDateTime(next.lesson.startsAt, data.settings.timezone)} · ${coverageLabels[next.readiness.financial.state]}${next.readiness.financial.amountDueMinor ? ` · ${formatMoney(next.readiness.financial.amountDueMinor, data.settings.currency)}` : ""}`
                : "None scheduled"}
            </dd>
          </div>
        </dl>
        {forecasts.map((forecast) => (
          <div className="communication-card" key={forecast.packageId}>
            <strong>
              {data.packages.find((pkg) => pkg.id === forecast.packageId)?.name}
            </strong>
            <p>
              {forecast.currentCredits} available credits ·{" "}
              {forecast.reservedLessonIds.length} already reserved ·{" "}
              {forecast.expectedConsumption} expected additional credits ·{" "}
              {forecast.projectedCredits} projected balance
            </p>
            <p>
              {forecast.uncoveredLessonIds.length
                ? `Package shortfall: ${forecast.uncoveredLessonIds.length} uncovered upcoming lesson(s).`
                : "Currently scheduled eligible lessons are covered."}
              {forecast.firstUncoveredLessonId
                ? ` First uncovered: ${formatStudioDateTime(data.lessons.find((lesson) => lesson.id === forecast.firstUncoveredLessonId)!.startsAt, data.settings.timezone)}.`
                : ""}
            </p>
            {forecast.expiresBeforeLessonIds.length > 0 && (
              <p>
                Package expires before {forecast.expiresBeforeLessonIds.length}{" "}
                upcoming lesson(s).
              </p>
            )}
          </div>
        ))}
        {!forecasts.length && (
          <p>No package is assigned. {upcoming.length} upcoming lesson(s).</p>
        )}
        <p>
          Forecasts do not consume credits. The payment and credit ledgers
          remain authoritative.
        </p>
      </Section>
    </div>
  );
}
