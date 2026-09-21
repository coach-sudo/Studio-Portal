import {
  CalendarDays,
  CheckSquare,
  CircleDollarSign,
  FileText,
  FolderOpen,
  Mail,
  MessageSquare,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import "../../components/IdentityActions.css";
import { JoinLessonBanner } from "../../components/JoinLessonBanner";
import { EmptyState, Section } from "../../components/Primitives";
import {
  formatMoney,
  packageSummary,
  studentBalanceMinor,
} from "../../domain/finance";
import {
  isJoinableLesson,
  sortAssignments,
  splitLessons,
} from "../../domain/lessonExperience";
import {
  formatStudioDate,
  formatStudioDateTime,
  formatStudioTime,
} from "../../domain/presentation";

import { type Snapshot } from "./StudentPortal.shared";

export function Header({ data }: { data: Snapshot }) {
  return (
    <header className="creative-welcome student-welcome">
      <div>
        <small>
          {formatStudioDate(new Date(), data.settings.timezone, {
            weekday: "long",
          })}
        </small>
        <h1>Welcome back, {data.displayName}</h1>
        <p>{data.settings.welcomeMessage}</p>
      </div>
      <i />
      <b />
    </header>
  );
}
function PortalRow({
  icon: Icon,
  title,
  detail,
  action,
  onClick,
}: {
  icon: typeof FileText;
  title: string;
  detail: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="portal-row">
      <Icon />
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      <button onClick={onClick}>
        {action}
        <span>›</span>
      </button>
    </div>
  );
}
export function StudentHome({ data, base }: { data: Snapshot; base: string }) {
  return (
    <div className="student-page">
      <Header data={data} />
      <JoinLessonBanner lessons={data.lessons} />
      <div className="student-quick-actions">
        {data.settings.showBookingButton && (
          <a href={data.settings.bookingUrl}>
            <CalendarDays />
            Book a lesson
          </a>
        )}
        {data.settings.showContactButtons && (
          <a href={`mailto:${data.settings.contactEmail}`}>
            <Mail />
            Email coach
          </a>
        )}
        {data.settings.showContactButtons && (
          <Link to={`${base}/inbox`}>
            <MessageSquare />
            Message coach
          </Link>
        )}
        {data.settings.showDriveFolder && data.students[0]?.driveFolderUrl && (
          <a
            href={data.students[0].driveFolderUrl}
            target="_blank"
            rel="noreferrer"
          >
            <FolderOpen />
            Drive folder
          </a>
        )}
      </div>
      <HomePriorities
        data={data}
        base={base}
        showAccount={!data.students[0]?.isMinor}
      />
    </div>
  );
}
export function GuardianHome({ data, base }: { data: Snapshot; base: string }) {
  const student = data.students[0];
  return (
    <div className="student-page">
      <Header data={data} />
      <JoinLessonBanner lessons={data.lessons} />
      <p className="portal-context-line">
        For {student?.preferredName || student?.fullName || "your student"}
      </p>
      <HomePriorities data={data} base={base} showAccount />
    </div>
  );
}

function HomePriorities({
  data,
  base,
  showAccount,
}: {
  data: Snapshot;
  base: string;
  showAccount: boolean;
}) {
  const navigate = useNavigate();
  const lesson = splitLessons(data.lessons).active[0];
  const work = data.materials
    .filter(
      (item) => item.role === "current_script" && item.status === "active",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const practice = sortAssignments(data.assignments).active[0];
  const pkg = data.packages[0];
  const student = data.students[0];
  return (
    <div className="portal-home-grid">
      <div className="portal-priority-stack">
        <Section title="Next lesson" marked>
          {lesson ? (
            <PortalRow
              icon={CalendarDays}
              title={lesson.topic}
              detail={`${formatStudioDateTime(lesson.startsAt, data.settings.timezone)} · ${lesson.locationLabel}`}
              action={isJoinableLesson(lesson) ? "Open lesson" : "View lesson"}
              onClick={() => navigate(`${base}/lessons/${lesson.id}`)}
            />
          ) : (
            <EmptyState
              title="No lesson scheduled"
              detail="Book a service when you are ready."
            />
          )}
        </Section>
        <Section title="Current work">
          {work ? (
            <PortalRow
              icon={FileText}
              title={work.title}
              detail="Your active script and lesson materials."
              action="Open work"
              onClick={() => navigate(`${base}/work`)}
            />
          ) : (
            <EmptyState
              title="No current work"
              detail="Nothing needs your attention here yet."
            />
          )}
        </Section>
        <Section title="Next practice">
          {practice ? (
            <PortalRow
              icon={CheckSquare}
              title={practice.title}
              detail={practice.details}
              action="Open practice"
              onClick={() => navigate(`${base}/work`)}
            />
          ) : (
            <EmptyState
              title="Practice is complete"
              detail="You are caught up."
            />
          )}
        </Section>
        {showAccount && pkg && student && (
          <details className="portal-account-summary">
            <summary>
              <span>Your package</span>
              <strong>
                {packageSummary(pkg, data.creditEntries).remainingCredits}{" "}
                sessions remaining
              </strong>
            </summary>
            <PortalRow
              icon={CircleDollarSign}
              title={pkg.name}
              detail={`${formatMoney(Math.max(0, studentBalanceMinor(student.id, data.payments)))} open balance`}
              action="View payments"
              onClick={() => navigate(`${base}/payments`)}
            />
          </details>
        )}
      </div>
      <aside className="dashboard-rail portal-rail">
        <header>
          <small>Your next steps</small>
          <strong>
            {formatStudioDate(new Date(), data.settings.timezone, {
              weekday: "long",
              month: "short",
            })}
          </strong>
        </header>
        {lesson && (
          <button onClick={() => navigate(`${base}/lessons/${lesson.id}`)}>
            <CalendarDays />
            <span>
              <strong>
                {formatStudioTime(lesson.startsAt, data.settings.timezone)}
              </strong>
              <small>Next lesson</small>
            </span>
          </button>
        )}
        {practice && (
          <button onClick={() => navigate(`${base}/work`)}>
            <CheckSquare />
            <span>
              <strong>{practice.title}</strong>
              <small>Next practice</small>
            </span>
          </button>
        )}
        {showAccount && pkg && (
          <button onClick={() => navigate(`${base}/payments`)}>
            <CircleDollarSign />
            <span>
              <strong>
                {packageSummary(pkg, data.creditEntries).remainingCredits}{" "}
                credits
              </strong>
              <small>Package balance</small>
            </span>
          </button>
        )}
      </aside>
    </div>
  );
}
