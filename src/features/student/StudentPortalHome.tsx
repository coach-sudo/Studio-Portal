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
import { formatMoney, studentBalanceMinor } from "../../domain/finance";
import { creditTotals } from "../../domain/credits";
import { isJoinableLesson } from "../../domain/lessonExperience";
import {
  formatStudioDate,
  formatStudioDateTime,
} from "../../domain/presentation";

import { type Snapshot } from "./StudentPortal.shared";
import {
  AssignedWorkSummary,
  PublishedFeedback,
} from "../../components/CoachingContinuity";
import {
  coachingContext,
  portalContextLink,
} from "../../domain/coachingContext";

export function Header({ data }: { data: Snapshot }) {
  return (
    <header className="creative-welcome student-welcome">
      <div>
        <small>
          {formatStudioDate(new Date(), data.settings.timezone, {
            weekday: "long",
          })}
        </small>
        <span className="eyebrow">{data.settings.portalLabel}</span>
        <h1>Welcome back, {data.displayName}</h1>
        {data.settings.welcomeMessage && (
          <details className="disclosure-section">
            <summary>Studio welcome message</summary>
            <p>{data.settings.welcomeMessage}</p>
          </details>
        )}
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
        {detail && <small>{detail}</small>}
      </div>
      <button onClick={onClick}>
        {action}
        <span>›</span>
      </button>
    </div>
  );
}
export function StudentHome({
  data,
  base,
  isDemo = false,
}: {
  data: Snapshot;
  base: string;
  isDemo?: boolean;
}) {
  return (
    <div className="student-page">
      <Header data={data} />
      <JoinLessonBanner lessons={data.lessons} />
      <HomePriorities
        data={data}
        base={base}
        isDemo={isDemo}
        showAccount={!data.students[0]?.isMinor}
      />
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
    </div>
  );
}
export function GuardianHome({
  data,
  base,
  isDemo,
  canViewWork,
  canViewSchedule,
  canViewFinance,
}: {
  data: Snapshot;
  base: string;
  isDemo: boolean;
  canViewWork: boolean;
  canViewSchedule: boolean;
  canViewFinance: boolean;
}) {
  return (
    <div className="student-page">
      <Header data={data} />
      {canViewSchedule && <JoinLessonBanner lessons={data.lessons} />}
      <HomePriorities
        data={data}
        base={base}
        isDemo={isDemo}
        showAccount={canViewFinance}
        showWork={canViewWork}
        showSchedule={canViewSchedule}
      />
    </div>
  );
}

function HomePriorities({
  data,
  base,
  showAccount,
  isDemo,
  showWork = true,
  showSchedule = true,
}: {
  data: Snapshot;
  base: string;
  showAccount: boolean;
  isDemo: boolean;
  showWork?: boolean;
  showSchedule?: boolean;
}) {
  const student = data.students[0];
  const open = useNavigate();
  const navigate = (path: string) => open(portalContextLink(path, student.id));
  const context = coachingContext(data, student.id)!;
  const lesson = showSchedule ? context.nextLesson : undefined;
  const work = showWork ? context.scripts[0] : undefined;
  const practice = showWork ? context.practice.active[0] : undefined;
  const credits = student
    ? creditTotals(
        data.packages,
        data.creditEntries,
        data.lessons,
        student.id,
        Date.now(),
        data.lessonParticipants,
      )
    : undefined;
  const balance = student
    ? studentBalanceMinor(student.id, data.payments, data.settings.currency)
    : 0;
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
          route: `${base}/work#practice-${practice.id}`,
        }
      : undefined,
    work
      ? {
          key: "work",
          icon: FileText,
          title: work.title,
          detail: "Current script",
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
              title="No upcoming lesson or practice"
              detail={
                showWork
                  ? "Your resources and shared feedback are below."
                  : "Your next scheduled lesson appears here."
              }
            />
          )}
        </Section>
        {secondary.length > 0 && (
          <Section title="Current work">
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
        {showAccount && student && credits && (
          <section className="portal-account-summary" aria-label="Account">
            <PortalRow
              icon={CircleDollarSign}
              title={`${credits.available} lesson credits available`}
              detail={[
                credits.reserved ? `${credits.reserved} reserved` : "",
                balance
                  ? `${formatMoney(Math.abs(balance), data.settings.currency)} ${balance > 0 ? "account credit" : "balance"}`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
              action="View payments"
              onClick={() => navigate(`${base}/payments`)}
            />
          </section>
        )}
      </div>
      {showWork && (
        <>
          <AssignedWorkSummary
            data={data}
            isDemo={isDemo}
            studentId={student.id}
          />
          <PublishedFeedback
            data={data}
            isDemo={isDemo}
            studentId={student.id}
          />
        </>
      )}
    </div>
  );
}
