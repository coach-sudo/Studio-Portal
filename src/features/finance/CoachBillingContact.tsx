import { Link } from "react-router-dom";
import { Section } from "../../components/Primitives";
import { invoiceBilling } from "../../domain/invoiceBilling";
import type { StudioSnapshot, Student } from "../../domain/model";
import { useStudentFinancialOverview } from "../../hooks/useStudentFinancialOverview";
import { InvoicePayerSetup } from "./InvoicePayerSetup";

const autopayLabels = {
  off: "No authorization",
  active: "Authorized",
  paused: "Paused",
  cancelled: "Ended",
  pending_setup: "Awaiting payer setup",
  needs_review: "Needs payer review",
};

export function CoachBillingContact({
  data,
  student,
  isDemo,
}: {
  data: StudioSnapshot;
  student: Student;
  isDemo: boolean;
}) {
  const overview = useStudentFinancialOverview(student.id, !isDemo);
  const billing = invoiceBilling(student, data.linkedContacts);
  const status = isDemo ? "off" : overview.data?.autopayStatus;
  const base = `/coach/students/${student.id}`;
  const packageAssigned = data.packages.some(
    (entry) =>
      entry.studentId === student.id &&
      (!entry.expiresAt || Date.parse(entry.expiresAt) > Date.now()),
  );
  return (
    <Section title="Billing contact">
      <dl className="billing-contact-details">
        <div>
          <dt>Student</dt>
          <dd>{student.fullName}</dd>
        </div>
        <div>
          <dt>Authorized payer</dt>
          <dd>{billing.issueError ? "Needs setup" : billing.recipient.name}</dd>
        </div>
        {billing.recipient.email && (
          <div>
            <dt>Contact email</dt>
            <dd>{billing.recipient.email}</dd>
          </div>
        )}
        <div>
          <dt>Billing arrangement</dt>
          <dd>
            {packageAssigned
              ? "Package credits and pay as you go"
              : "Pay as you go"}
          </dd>
        </div>
        <div>
          <dt>Automatic-payment authorization</dt>
          <dd>
            {status
              ? autopayLabels[status]
              : overview.isPending
                ? "Loading…"
                : "Unavailable"}
          </dd>
        </div>
      </dl>
      <div className="lesson-invoice-payer">
        <p>{billing.deliveryError ?? "Invoice email delivery is available."}</p>
        {billing.issueError && (
          <InvoicePayerSetup
            student={student}
            contacts={data.linkedContacts}
            isDemo={isDemo}
          />
        )}
        <Link to={`${base}/household`}>Manage household contacts</Link>
      </div>
    </Section>
  );
}
