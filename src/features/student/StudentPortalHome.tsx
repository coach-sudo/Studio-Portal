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
        {data.settings.showContactButtons && (
          <Link className="primary-contact-action" to={`${base}/inbox`}>
            <MessageSquare />
            Message coach
          </Link>
        )}
        {data.settings.showBookingButton && (
          <a href={data.settings.bookingUrl}>
            <CalendarDays />
            Book a lesson
          </a>
        )}
        {data.settings.showContactButtons && (
          <a
            className="secondary-contact-action"
            href={`mailto:${data.settings.contactEmail}`}
          >
            <Mail />
            Email coach
          </a>
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
  return (
    <div className="student-page">
      <Header data={data} />
      <JoinLessonBanner lessons={data.lessons} />
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
  const lessonIsJoinable = Boolean(lesson && isJoinableLesson(lesson));
  const actions = [
    !lessonIsJoinable && lesson
      ? {
          key: "lesson",
          icon: CalendarDays,
          title: lesson.topic,
          detail: `${formatStudioDateTime(lesson.startsAt, data.settings.timezone)} · ${lesson.locationLabel}`,
          action: "View lesson",
          route: `${base}/lessons/${lesson.id}`,
        }
      : undefined,
    practice
      ? {
          key: "practice",
          icon: CheckSquare,
          title: practice.title,
          detail: practice.details,
          action: "Open practice",
          route: `${base}/work`,
        }
      : undefined,
    work
      ? {
          key: "work",
          icon: FileText,
          title: work.title,
          detail: "Your active script and lesson materials.",
          action: "Open work",
          route: `${base}/work`,
        }
      : undefined,
  ].filter(Boolean) as Array<{
    key: string;
    icon: typeof FileText;
    title: string;
    detail: string;
    action: string;
    route: string;
  }>;
  const [primary, ...secondary] = actions;
  return (
    <div className="portal-home-grid portal-home-prioritized">
      <div className="portal-priority-stack">
        <Section title="Up next" marked>
          {primary ? (
            <PortalRow
              icon={primary.icon}
              title={primary.title}
              detail={primary.detail}
              action={primary.action}
              onClick={() => navigate(primary.route)}
            />
          ) : (
            <EmptyState
              title="You’re caught up"
              detail="There is no lesson or practice that needs your attention right now."
            />
          )}
        </Section>
        {secondary.length > 0 && (
          <Section title="Also in your workspace">
            <div className="portal-action-queue">
              {secondary.map((item) => (
                <PortalRow
                  key={item.key}
                  icon={item.icon}
                  title={item.title}
                  detail={item.detail}
                  action={item.action}
                  onClick={() => navigate(item.route)}
                />
              ))}
            </div>
          </Section>
        )}
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
    </div>
  );
}
