import {
  CalendarDays,
  CheckSquare,
  CircleDollarSign,
  FileText,
  FolderOpen,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Section } from "../../components/Primitives";
import {
  formatMoney,
  packageSummary,
  studentBalanceMinor,
} from "../../domain/finance";
import type { Student } from "../../domain/model";
import {
  formatStudioDate,
  formatStudioDateTime,
} from "../../domain/presentation";

import { belongsToStudent, type Data } from "./StudentWorkspace.shared";

export function Overview({
  data,
  student,
  onAddAssignment,
  onAddMaterial,
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
                pkg
                  ? `${packageSummary(pkg, data.creditEntries).remainingCredits} sessions left`
                  : "Pay as you go"
              }
              detail={`Balance ${formatMoney(Math.max(0, studentBalanceMinor(student.id, data.payments)))}`}
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
        <Section title="Quick add">
          <div className="stack-actions">
            <button onClick={onAddAssignment}>
              <CheckSquare />
              Assign practice
            </button>
            <button onClick={onAddMaterial}>
              <FolderOpen />
              Add material
            </button>
          </div>
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
      <small>{detail}</small>
    </Link>
  );
}
