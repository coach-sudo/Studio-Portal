import {
  usePortalContexts,
  type PortalContext,
} from "../../data/portalContext";
import { isDemoMode, isSupabaseConfigured } from "../../lib/supabase";
import "../../styles/appearance.css";
import {
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Search,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState, useRef } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { portalNavigation } from "../../app/portalNavigation";
import { RecordRoute, RecordUnavailable } from "../../components/RecordRoute";
import { WorkspaceSearch } from "../../components/WorkspaceSearch";
import { WorkspaceScrollRestoration } from "../../hooks/useWorkspaceLocation";
import { useStudioStore, scopeStudioSnapshot } from "../../state/StudioStore";
import { Dialog } from "../../components/Primitives";
import { ActivityCenter } from "../../components/ActivityCenter";
import { DailyPopup } from "../../components/DailyPopup";
import "../../components/IdentityActions.css";
import type { Role } from "../../domain/model";
import { useSidebarCollapse } from "../../hooks/useSidebarCollapse";
import { useStudioRoute } from "../../hooks/useStudio";
import { applyStudioBranding } from "../../lib/branding";
import { SessionAction } from "../../components/SessionAction";
import { portalDomains } from "./StudentPortal.shared";
import { GuardianHome, StudentHome } from "./StudentPortalHome";

const PortalClassWorkspace = lazy(() =>
  import("../classes/ClassWorkspace").then((module) => ({
    default: module.PortalClassWorkspace,
  })),
);
const PortalInbox = lazy(() =>
  import("../messages/Inbox").then((module) => ({
    default: module.PortalInbox,
  })),
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
  const store = useStudioStore(),
    [params, setParams] = useSearchParams(),
    previous = useRef<string | undefined>(undefined),
    validated = useRef<string | undefined>(undefined),
    [contextPage, setContextPage] = useState(1);
  const demo = !isSupabaseConfigured && isDemoMode;
  const requested = params.get("student") || undefined;
  const authorized = usePortalContexts(
    requested || previous.current,
    contextPage,
    !demo,
  );
  const demoIdentity = scopeStudioSnapshot(
      store.snapshot,
      role,
      role === "guardian" ? "student-sarah" : "student-maya",
    ),
    first = demoIdentity.students[0];
  const demoContexts =
    role === "guardian" && first?.guardianEmail
      ? store.snapshot.students.filter(
          (s) => s.id === first.id || s.guardianEmail === first.guardianEmail,
        )
      : demoIdentity.students;
  const available = demo ? demoContexts : authorized.data?.items || [];
  const selected = requested || previous.current || available[0]?.id;
  const access = demo ? undefined : authorized.data?.selected;
  const contexts =
    access && !available.some((s) => s.id === access.id)
      ? [access, ...available]
      : available;
  const permitted =
    !!selected &&
    (demo
      ? contexts.some((s) => s.id === selected)
      : requested
        ? access?.id === selected
        : contexts.some((s) => s.id === selected));
  useEffect(() => {
    if (selected && permitted && !authorized.isFetching) {
      validated.current = `${authorized.identity}:${selected}`;
      previous.current = selected;
      if (!requested)
        setParams(
          (p) => {
            const next = new URLSearchParams(p);
            next.set("student", selected);
            return next;
          },
          { replace: true },
        );
    }
  }, [
    selected,
    permitted,
    requested,
    setParams,
    authorized.isFetching,
    authorized.identity,
  ]);
  if (
    !demo &&
    (authorized.isFetching || authorized.isPending) &&
    validated.current !== `${authorized.identity}:${selected}` &&
    !authorized.isError
  )
    return (
      <div className="loading" role="status">
        Checking student access…
      </div>
    );
  if (authorized.isError || !selected || !permitted)
    return <RecordUnavailable fallback="/portal" />;
  return (
    <>
      <PortalWorkspace
        key={selected}
        role={role}
        studentId={selected}
        contexts={contexts}
        access={access || undefined}
      />
      {!demo && (contextPage > 1 || authorized.data?.hasMore) && (
        <nav aria-label="Student selector pages">
          <button
            disabled={contextPage === 1}
            onClick={() => setContextPage((p) => p - 1)}
          >
            Previous students
          </button>
          <button
            disabled={!authorized.data?.hasMore}
            onClick={() => setContextPage((p) => p + 1)}
          >
            More students
          </button>
        </nav>
      )}
    </>
  );
}
function PortalWorkspace({
  role,
  studentId,
  contexts,
  access,
}: {
  role: Extract<Role, "student" | "guardian">;
  studentId: string;
  contexts: { id: string; fullName: string; preferredName?: string | null }[];
  access?: PortalContext;
}) {
  const location = useLocation();
  const {
    data: routeData,
    isLoading,
    isDemo,
    error,
  } = useStudioRoute(role, studentId, portalDomains(location.pathname));
  const data =
    routeData && routeData.students.some((s) => s.id === studentId)
      ? {
          ...scopeStudioSnapshot(routeData, role, studentId),
          displayName: routeData.displayName,
          currentLinkedContactId: routeData.currentLinkedContactId,
        }
      : undefined;
  const base = "/portal";
  const portalPath = (to: string) => {
    const p = new URLSearchParams();
    p.set("student", studentId);
    return base + (to ? "/" + to : "") + "?" + p;
  };
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
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
  if (error) return <RecordUnavailable fallback="/portal" />;
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
    access?.canViewFinance ??
    linkedAccess?.canViewFinance ??
    (isDemo && Boolean(person?.isMinor));
  const guardianSchedule =
    access?.canViewSchedule ?? linkedAccess?.canViewSchedule ?? isDemo;
  const guardianWork =
    access?.canViewWork ?? linkedAccess?.canViewWork ?? isDemo;
  const guardianProfile =
    access?.canManageProfile ?? linkedAccess?.canManageProfile ?? isDemo;
  const guardianManageLessons =
    access?.canManageLessons ?? linkedAccess?.canManageLessons ?? isDemo;
  const tabs = portalNavigation(role, Boolean(person?.isMinor), {
    canViewFinance: guardianFinance,
    canViewSchedule: guardianSchedule,
    canViewWork: guardianWork,
    canManageProfile: guardianProfile,
  });
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
        <nav aria-label="Portal navigation">
          {tabs
            .filter((t) =>
              ["", "work", "bookings", "inbox", "payments"].includes(t.to),
            )
            .map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={portalPath(to)} end={!to}>
                <Icon />
                <span>{label}</span>
              </NavLink>
            ))}
          <button type="button" onClick={() => setMobileMenuOpen(true)}>
            <Menu aria-hidden="true" />
            <span>More</span>
          </button>
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
        </div>
        <SessionAction isDemo={isDemo} sidebar />
      </aside>
      <main id="portal-main-content" tabIndex={-1}>
        <WorkspaceScrollRestoration />
        <div className="workspace-student-context">
          {role === "guardian" && contexts.length > 1 && (
            <label>
              Student
              <select
                value={studentId}
                onChange={(e) => {
                  navigatePortal(
                    "/portal?student=" + encodeURIComponent(e.target.value),
                  );
                }}
              >
                {contexts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.preferredName || s.fullName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search portal"
          >
            <Search aria-hidden="true" />
            Search
          </button>
        </div>
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
        <Suspense
          fallback={
            <div className="loading" role="status">
              Opening this section…
            </div>
          }
        >
          <Routes>
            <Route
              path="records/:kind/:recordId"
              element={<RecordRoute audience={role} portalData={data} />}
            />
            <Route
              index
              element={
                role === "guardian" ? (
                  <GuardianHome
                    data={data}
                    base={base}
                    isDemo={isDemo}
                    canViewWork={guardianWork}
                    canViewSchedule={guardianSchedule}
                    canViewFinance={guardianFinance}
                  />
                ) : (
                  <StudentHome data={data} base={base} isDemo={isDemo} />
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
              element={
                <Navigate
                  to={`${base}/bookings${location.search}${location.hash}`}
                  state={location.state}
                  replace
                />
              }
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
                  showWork={role !== "guardian" || guardianWork}
                  showSchedule={role !== "guardian" || guardianSchedule}
                />
              }
            />
            <Route
              path="notes"
              element={
                role === "guardian" && !guardianWork ? (
                  <RecordUnavailable fallback={portalPath("")} />
                ) : (
                  <StudentNotes data={data} isDemo={isDemo} />
                )
              }
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
              element={
                <Navigate
                  to={`${base}/work${location.search}${location.hash}`}
                  state={location.state}
                  replace
                />
              }
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
      <ActivityCenter data={data} audience={role} studentId={studentId} />
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
          <NavLink key={to} to={portalPath(to)} end={!to}>
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
      {searchOpen && (
        <WorkspaceSearch
          audience={role}
          studentId={studentId}
          destinations={tabs.map((t) => ({ ...t, to: portalPath(t.to) }))}
          demoData={isDemo ? data : undefined}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {mobileMenuOpen && (
        <Dialog
          title="Student portal menu"
          className="navigation-sheet"
          onClose={() => setMobileMenuOpen(false)}
        >
          <nav className="workspace-more-group" aria-label="More destinations">
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                setSearchOpen(true);
              }}
            >
              Search
            </button>
            {tabs.map(({ to, label, icon: Icon }) => (
              <button
                type="button"
                key={to}
                onClick={() => {
                  navigatePortal(portalPath(to));
                  setMobileMenuOpen(false);
                }}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
            <SessionAction isDemo={isDemo} />
          </nav>
        </Dialog>
      )}
    </div>
  );
}
