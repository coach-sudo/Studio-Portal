import {
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { portalNavigation } from "../../app/portalNavigation";
import { ActivityCenter } from "../../components/ActivityCenter";
import { DailyPopup } from "../../components/DailyPopup";
import "../../components/IdentityActions.css";
import type { Role } from "../../domain/model";
import { useSidebarCollapse } from "../../hooks/useSidebarCollapse";
import { useStudioRoute } from "../../hooks/useStudio";
import { applyStudioBranding } from "../../lib/branding";
import { supabase } from "../../lib/supabase";
import { portalDomains } from "./StudentPortal.shared";
import { GuardianHome, StudentHome } from "./StudentPortalHome";

const PortalClassWorkspace = lazy(() =>
  import("../classes/ClassWorkspace").then((module) => ({
    default: module.PortalClassWorkspace,
  })),
);
const PortalInbox = lazy(() =>
  import("../messages/Inbox").then((module) => ({ default: module.PortalInbox })),
);
const StudentReferrals = lazy(() =>
  import("../referrals/Referrals").then((module) => ({
    default: module.StudentReferrals,
  })),
);
const ActorPage = lazy(() =>
  import("./StudentPortalActorPage").then((module) => ({
    default: module.ActorPage,
  })),
);
const LessonHub = lazy(() =>
  import("./StudentPortalLessonHub").then((module) => ({
    default: module.LessonHub,
  })),
);
const StudentNotes = lazy(() =>
  import("./StudentPortalLessonHub").then((module) => ({
    default: module.StudentNotes,
  })),
);
const Payments = lazy(() =>
  import("./StudentPortalPayments").then((module) => ({
    default: module.Payments,
  })),
);
const StudentBookings = lazy(() =>
  import("./StudentPortalSchedule").then((module) => ({
    default: module.StudentBookings,
  })),
);
const StudentSettings = lazy(() =>
  import("./StudentPortalSettings").then((module) => ({
    default: module.StudentSettings,
  })),
);
const Work = lazy(() =>
  import("./StudentPortalWork").then((module) => ({ default: module.Work })),
);

export function StudentPortal({
  role = "student",
}: {
  role?: Extract<Role, "student" | "guardian">;
}) {
  const studentId = role === "guardian" ? "student-sarah" : "student-maya";
  const location = useLocation();
  const { data, isLoading, isDemo } = useStudioRoute(
    role,
    studentId,
    portalDomains(location.pathname),
  );
  const base = "/portal";
  const navigatePortal = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useSidebarCollapse();
  useEffect(() => {
    if (data?.settings.studioName)
      document.title = `${data.settings.studioName} — ${role === "guardian" ? "Guardian" : "Student"} · Coach’D`;
  }, [data?.settings.studioName, role]);
  useEffect(
    () => applyStudioBranding(data?.settings.branding),
    [data?.settings.branding],
  );
  const portalAppearance =
    role === "guardian"
      ? data?.linkedContacts.find(
          (contact) => contact.id === data.currentLinkedContactId,
        )?.portalPreferences?.appearance || "light"
      : data?.students[0]?.portalPreferences?.appearance ||
        data?.settings.portalDefaults.appearance ||
        "light";
  useEffect(() => {
    document.documentElement.dataset.portalTheme = portalAppearance;
    return () => {
      delete document.documentElement.dataset.portalTheme;
    };
  }, [portalAppearance]);
  if (isLoading || !data)
    return <div className="loading">Preparing your workspace…</div>;
  const person = data.students[0];
  const linkedAccess =
    role === "guardian"
      ? data.linkedContacts.find(
          (contact) => contact.id === data.currentLinkedContactId,
        )
      : undefined;
  const guardianFinance =
    linkedAccess?.canViewFinance ?? Boolean(person?.isMinor);
  const guardianSchedule = linkedAccess?.canViewSchedule ?? true;
  const guardianWork = linkedAccess?.canViewWork ?? true;
  const guardianProfile = linkedAccess?.canManageProfile ?? true;
  const guardianManageLessons = linkedAccess?.canManageLessons ?? true;
  const tabs = portalNavigation(role, Boolean(person?.isMinor), linkedAccess);
  const studentDisplayName =
    person?.preferredName || person?.fullName || "Student";
  const initials =
    (role === "guardian" ? data.displayName : studentDisplayName)
      ?.split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2) || "SS";
  const identityPhoto =
    role === "student" ? person?.profilePhotoUrl : undefined;
  return (
    <div
      className={`student-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
    >
      <a className="skip-link" href="#portal-main-content">
        Skip to main content
      </a>
      <aside>
        <div className="shell-brand">
          {data.settings.branding?.logoUrl && (
            <img src={data.settings.branding.logoUrl} alt="" />
          )}
          {!data.settings.branding?.logoUrl && (
            <span className="shell-mark" aria-hidden="true">
              C’D
            </span>
          )}
          <div className="wordmark">Coach'D</div>
          <button
            type="button"
            className="sidebar-collapse"
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </div>
        <nav>
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={`${base}/${to}`} end={!to}>
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="identity">
          <span className={identityPhoto ? "has-photo" : ""}>
            {identityPhoto ? (
              <img
                src={identityPhoto}
                alt=""
                style={{
                  objectPosition: `${person?.profilePhotoPosition?.x ?? 50}% ${person?.profilePhotoPosition?.y ?? 50}%`,
                }}
              />
            ) : (
              initials
            )}
          </span>
          <div>
            <strong>
              {role === "guardian" ? data.displayName : studentDisplayName}
            </strong>
            <small>
              {role === "guardian"
                ? `${linkedAccess?.relationshipLabel || linkedAccess?.relationshipType?.replaceAll("_", " ") || (person?.isMinor ? "Guardian" : "Support person")} for ${person?.fullName ?? "student"}`
                : "Student"}
            </small>
          </div>
          <button
            type="button"
            className="identity-signout"
            aria-label="Sign out"
            onClick={async () => {
              await supabase?.auth.signOut();
              navigatePortal("/login", { replace: true });
            }}
          >
            <LogOut aria-hidden="true" />
          </button>
        </div>
      </aside>
      <main id="portal-main-content" tabIndex={-1}>
        {isDemo && (
          <div className="demo-banner">
            <ShieldCheck />
            Practice, profile, and studio-work changes are saved on this device.
            Live charges remain in preview until Stripe is connected.
          </div>
        )}
        {role === "guardian" && (
          <section
            className="guardian-context guardian-context-shell"
            aria-label="Household context"
          >
            <div>
              <small>You’re viewing</small>
              <strong>{studentDisplayName}’s workspace</strong>
            </div>
            <span>
              {linkedAccess?.relationshipLabel ||
                linkedAccess?.relationshipType?.replaceAll("_", " ") ||
                "Household access"}
            </span>
          </section>
        )}
        <Suspense fallback={<div className="loading" role="status">Opening this section…</div>}>
        <Routes>
          <Route
            index
            element={
              role === "guardian" ? (
                <GuardianHome data={data} base={base} />
              ) : (
                <StudentHome data={data} base={base} />
              )
            }
          />
          <Route
            path="work"
            element={
              role === "guardian" && !guardianWork ? (
                <Navigate to={base} replace />
              ) : (
                <Work data={data} isDemo={isDemo} />
              )
            }
          />
          <Route
            path="bookings"
            element={
              role === "guardian" && !guardianSchedule ? (
                <Navigate to={base} replace />
              ) : (
                <StudentBookings
                  data={data}
                  isDemo={isDemo}
                  canManageLessons={
                    role !== "guardian" || guardianManageLessons
                  }
                />
              )
            }
          />
          <Route
            path="lessons"
            element={<Navigate to={`${base}/bookings`} replace />}
          />
          <Route
            path="lessons/:lessonId"
            element={
              <LessonHub
                data={data}
                isDemo={isDemo}
                showFinance={
                  role === "guardian" ? guardianFinance : !person?.isMinor
                }
              />
            }
          />
          <Route
            path="notes"
            element={<StudentNotes data={data} isDemo={isDemo} />}
          />
          <Route
            path="classes/:offeringId"
            element={
              <PortalClassWorkspace data={data} isDemo={isDemo} role={role} />
            }
          />
          <Route
            path="inbox"
            element={<PortalInbox data={data} isDemo={isDemo} role={role} />}
          />
          <Route
            path="referrals"
            element={
              <StudentReferrals
                students={data.students}
                settings={data.settings}
                isDemo={isDemo}
              />
            }
          />
          <Route
            path="practice"
            element={<Navigate to={`${base}/work`} replace />}
          />
          <Route
            path="materials"
            element={<Navigate to={`${base}/work`} replace />}
          />
          <Route
            path="payments"
            element={
              (role === "guardian" ? guardianFinance : !person?.isMinor) ? (
                <Payments data={data} isDemo={isDemo} />
              ) : (
                <Navigate to={base} replace />
              )
            }
          />
          <Route
            path="actor-page"
            element={
              role === "guardian" && !guardianProfile ? (
                <Navigate to={base} replace />
              ) : (
                <ActorPage data={data} isDemo={isDemo} />
              )
            }
          />
          <Route
            path="settings"
            element={
              <StudentSettings data={data} isDemo={isDemo} role={role} />
            }
          />
          <Route path="*" element={<Navigate to={base} replace />} />
        </Routes>
        </Suspense>
      </main>
      <ActivityCenter data={data} audience={role} />
      <DailyPopup
        popup={data.settings.dailyPopup}
        studioId={data.studioId}
        viewerId={
          role === "guardian"
            ? `guardian:${data.currentLinkedContactId || data.displayName}`
            : `student:${person?.id || data.displayName}`
        }
      />
      <nav className="mobile-nav student-mobile">
        {tabs.slice(0, 4).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={`${base}/${to}`} end={!to}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
        {tabs.length > 4 && (
          <button type="button" onClick={() => setMobileMenuOpen(true)}>
            <Menu />
            <span>More</span>
          </button>
        )}
      </nav>
      {mobileMenuOpen && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setMobileMenuOpen(false)
          }
        >
          <section
            className="command-dialog mobile-workspace-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Student portal menu"
          >
            <header>
              <Menu />
              <strong>Portal menu</strong>
              <button
                type="button"
                aria-label="Close portal menu"
                onClick={() => setMobileMenuOpen(false)}
              >
                ×
              </button>
            </header>
            {tabs.map(({ to, label, icon: Icon }) => (
              <button
                type="button"
                key={to}
                onClick={() => {
                  navigatePortal(`${base}${to ? `/${to}` : ""}`);
                  setMobileMenuOpen(false);
                }}
              >
                <Icon />
                <span>{label}</span>
              </button>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
