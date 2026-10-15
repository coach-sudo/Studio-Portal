import {
  CalendarDays,
  CheckSquare,
  CircleDollarSign,
  FileText,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Section } from "../../components/Primitives";
import { formatMoney, studentBalanceMinor } from "../../domain/finance";
import { creditTotals } from "../../domain/credits";
import type { Student } from "../../domain/model";
import {
  formatStudioDate,
  formatStudioDateTime,
} from "../../domain/presentation";

import { belongsToStudent, type Data } from "./StudentWorkspace.shared";
import { useQuery } from "@tanstack/react-query";
import { loadWorkspaceSummary } from "../../data/studentWorkspace";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";

export function Overview({
  data,
  student,
  onAddAssignment,
  onAddMaterial,
  isDemo = false,
}: {
  data: Data;
  student: Student;
  onAddAssignment: () => void;
  onAddMaterial: () => void;
  isDemo?: boolean;
}) {
  return isDemo ? (
    <DemoOverview
      data={data}
      student={student}
      onAddAssignment={onAddAssignment}
      onAddMaterial={onAddMaterial}
    />
  ) : (
    <LiveOverview student={student} timezone={data.settings.timezone} />
  );
}

function LiveOverview({
  student,
  timezone,
}: {
  student: Student;
  timezone: string;
}) {
  const identity = usePrivateIdentity();
  const query = useQuery({
    queryKey: ["student-workspace-summary", identity, student.id],
    enabled: !!identity,
    queryFn: ({ signal }) => loadWorkspaceSummary(student.id, signal),
    refetchInterval: 30000,
  });
  const summary = query.isError ? undefined : query.data;
  const base = `/coach/students/${student.id}`;
  if (!summary)
    return (
      <Section title="Overview">
        <p role={query.isError ? "alert" : "status"}>
          {query.isError
            ? "Student summary unavailable."
            : "Loading current context…"}
        </p>
        {query.isError && (
          <button onClick={() => void query.refetch()}>Retry summary</button>
        )}
      </Section>
    );
  return (
    <div className="record-overview">
      <div className="record-main">
        <Section title="What matters now" marked>
          <div className="focus-grid">
            <RecordCard
              icon={CalendarDays}
              label="Next lesson"
              value={
                summary.nextLesson
                  ? formatStudioDateTime(summary.nextLesson.startsAt, timezone)
                  : "Nothing scheduled"
              }
              detail={summary.nextLesson?.topic || ""}
              link={
                summary.nextLesson
                  ? `${base}/lessons/${summary.nextLesson.id}`
                  : `${base}/lessons`
              }
            />
            <RecordCard
              icon={FileText}
              label="Latest coaching note"
              value={summary.latestNote?.title || "No coaching note yet"}
              detail={
                summary.latestNote
                  ? `${summary.latestNote.status} · ${summary.latestNote.takeaway}`
                  : ""
              }
              link={
                summary.latestNote
                  ? `${base}/notes?note=${summary.latestNote.id}&lesson=${summary.latestNote.lessonId}`
                  : `${base}/notes`
              }
            />
          </div>
        </Section>
        <Section title="Current work">
          <div className="table-list">
            {summary.work.map((item) => (
              <article key={item.assignmentId}>
                <div>
                  <Link
                    to={`${base}/work?resource=${item.id}&assignment=${item.assignmentId}`}
                  >
                    {item.title}
                  </Link>
                  <small>
                    {item.role === "current_script"
                      ? "Current script"
                      : "Assigned resource"}
                  </small>
                </div>
              </article>
            ))}
            {summary.practice.map((item) => (
              <article key={item.id}>
                <div>
                  <Link to={`${base}/work?practice=${item.id}`}>
                    {item.title}
                  </Link>
                  {item.helpRequested && <small>Help requested</small>}
                </div>
              </article>
            ))}
            {!summary.work.length && !summary.practice.length && (
              <p>No active work assigned.</p>
            )}
          </div>
          <Link to={`${base}/work`}>All work and history</Link>
        </Section>
        <details className="disclosure-section">
          <summary>Goals and private coaching context</summary>
          <div className="record-copy">
            <p>{student.goals || "No goals recorded."}</p>
            <p>{student.privateNotes || "No private context recorded."}</p>
          </div>
        </details>
      </div>
      <aside className="record-side">
        <Section title="Needs attention">
          <div className="stack-actions">
            {summary.questions > 0 && (
              <Link to={`${base}/work?help=1`}>
                {summary.questions} practice question(s)
              </Link>
            )}
            {summary.approvals > 0 && (
              <Link to={`${base}/actor-page`}>
                {summary.approvals} approval(s)
              </Link>
            )}
            {(summary.finance.reviewRequired ||
              summary.finance.pendingPayments > 0 ||
              summary.finance.renewalExceptions > 0 ||
              summary.finance.expiringPackages > 0 ||
              summary.finance.unpaidInvoices > 0 ||
              summary.finance.balances.some((item) => item.dueMinor > 0)) && (
              <Link to={`${base}/payments`}>
                {summary.finance.reviewRequired
                  ? "Financial review required"
                  : summary.finance.unpaidInvoices
                    ? `${summary.finance.unpaidInvoices} unpaid invoice(s)`
                    : summary.finance.pendingPayments
                      ? "Payment processing needs review"
                      : summary.finance.balances.some(
                            (item) => item.dueMinor > 0,
                          )
                        ? "Recorded payment is due"
                        : "Package expiry or renewal needs review"}
              </Link>
            )}
            {!student.portalEnabled && (
              <Link to={`${base}/household`}>Student portal access is off</Link>
            )}
            {!summary.questions &&
              !summary.approvals &&
              !summary.finance.reviewRequired &&
              !summary.finance.unpaidInvoices &&
              !summary.finance.pendingPayments &&
              !summary.finance.renewalExceptions &&
              !summary.finance.expiringPackages &&
              !summary.finance.balances.some((item) => item.dueMinor > 0) &&
              student.portalEnabled && <p>No current exceptions.</p>}
          </div>
        </Section>
        <Section title="Contact">
          <p>{student.email || "No email recorded"}</p>
          <p>{student.phone}</p>
          <Link to={`${base}/household`}>Household and responsibilities</Link>
        </Section>
      </aside>
    </div>
  );
}

function DemoOverview({
  data,
  student,
}: {
  data: Data;
  student: Student;
  onAddAssignment: () => void;
  onAddMaterial: () => void;
}) {
  const upcoming = data.lessons
    .filter(
      (item) =>
        belongsToStudent(data, item, student.id) &&
        item.status === "scheduled" &&
        new Date(item.startsAt).getTime() >= Date.now(),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const assignment = data.assignments.find(
    (item) => item.studentId === student.id && item.status !== "completed",
  );
  const current = data.materials.find(
    (item) =>
      item.studentId === student.id &&
      item.role === "current_script" &&
      item.status === "active",
  );
  const pkg = data.packages.find((item) => item.studentId === student.id);
  const credits = creditTotals(
    data.packages,
    data.creditEntries,
    data.lessons,
    student.id,
    Date.now(),
    data.lessonParticipants,
  );
  const balance = studentBalanceMinor(
    student.id,
    data.payments,
    data.settings.currency,
  );
  return (
    <div className="record-overview">
      <div className="record-main">
        <Section title="What matters now" marked>
          <div className="focus-grid">
            <RecordCard
              icon={CalendarDays}
              label="Next lesson"
              value={
                upcoming
                  ? formatStudioDateTime(
                      upcoming.startsAt,
                      data.settings.timezone,
                    )
                  : "Nothing scheduled"
              }
              detail={upcoming?.topic || "Add a lesson when ready"}
              link={`${`/coach/students/${student.id}/lessons`}`}
            />
            <RecordCard
              icon={FileText}
              label="Current work"
              value={current?.title || "No active script"}
              detail={
                current?.category || "Add the material they are working on"
              }
              link={`/coach/students/${student.id}/work`}
            />
            <RecordCard
              icon={CheckSquare}
              label="Practice"
              value={assignment?.title || "Caught up"}
              detail={assignment?.details || "No open assignment"}
              link={`/coach/students/${student.id}/work`}
            />
            <RecordCard
              icon={CircleDollarSign}
              label="Account"
              value={
                pkg ? `${credits.available} credits available` : "Pay as you go"
              }
              detail={
                balance
                  ? `${formatMoney(Math.abs(balance), data.settings.currency)} ${balance > 0 ? "account credit" : "balance"}`
                  : ""
              }
              link={`/coach/students/${student.id}/payments`}
            />
          </div>
        </Section>
        <Section title="Goals & coaching context">
          <div className="record-copy">
            <div>
              <span>Goals</span>
              <p>{student.goals || "No goals recorded yet."}</p>
            </div>
            <div>
              <span>Private coach notes</span>
              <p>
                {student.privateNotes || "No private context recorded yet."}
              </p>
            </div>
          </div>
        </Section>
      </div>
      <aside className="record-side">
        <Section title="Contact">
          <dl className="detail-list">
            <div>
              <dt>Email</dt>
              <dd>{student.email || "—"}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{student.phone || "—"}</dd>
            </div>
            {student.isMinor && (
              <>
                <div>
                  <dt>Guardian</dt>
                  <dd>{student.guardianName || "—"}</dd>
                </div>
                <div>
                  <dt>Guardian email</dt>
                  <dd>{student.guardianEmail || "—"}</dd>
                </div>
              </>
            )}
            <div>
              <dt>Lead source</dt>
              <dd>{student.leadSource || "—"}</dd>
            </div>
            <div>
              <dt>Last contact</dt>
              <dd>
                {student.lastContactAt
                  ? formatStudioDate(
                      student.lastContactAt,
                      data.settings.timezone,
                    )
                  : "—"}
              </dd>
            </div>
          </dl>
        </Section>
      </aside>
    </div>
  );
}
function RecordCard({
  icon: Icon,
  label,
  value,
  detail,
  link,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  detail: string;
  link: string;
}) {
  return (
    <Link className="record-card" to={link}>
      <Icon />
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </Link>
  );
}
