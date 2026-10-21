import { Menu, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { useStudioRoute } from "../hooks/useStudio";
import { applyStudioBranding } from "../lib/branding";
import { Dialog } from "./Primitives";
import { ActivityCenter } from "./ActivityCenter";
import { WorkspaceSearch } from "./WorkspaceSearch";
import { WorkspaceScrollRestoration } from "../hooks/useWorkspaceLocation";
import { coachNavigation, studioNavigation } from "../app/coachNavigation";
import { useSidebarCollapse } from "../hooks/useSidebarCollapse";
import { SessionAction } from "./SessionAction";
import "./IdentityActions.css";

export function AppShell() {
  const { data, isDemo } = useStudioRoute("coach", undefined, ["identity"]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useSidebarCollapse();
  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, []);
  useEffect(() => {
    const branding = data?.settings.branding;
    if (!branding) return;
    applyStudioBranding(branding);
  }, [data?.settings.branding]);
  useEffect(() => {
    if (data?.settings.studioName)
      document.title = `${data.settings.studioName} — Coach’D`;
  }, [data?.settings.studioName]);
  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar" aria-label="Studio sidebar">
        <div className="shell-brand">
          {data?.settings.branding?.logoUrl && (
            <img src={data.settings.branding.logoUrl} alt="" />
          )}
          {!data?.settings.branding?.logoUrl && (
            <span className="shell-mark" aria-hidden="true">
              C’D
            </span>
          )}
          <div className="wordmark">
            {data?.settings.studioName ?? "Coach’D"}
          </div>
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
        <button
          type="button"
          className="shell-search"
          onClick={(event) => {
            event.currentTarget.focus();
            setSearchOpen(true);
          }}
          aria-label="Search records and destinations"
        >
          <Search aria-hidden="true" />
          <span>Search</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav aria-label="Coach navigation">
          {coachNavigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/coach"}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="identity">
          <span
            className={
              data?.settings.branding.coachProfilePhotoUrl ? "has-photo" : ""
            }
          >
            {data?.settings.branding.coachProfilePhotoUrl ? (
              <img
                src={data.settings.branding.coachProfilePhotoUrl}
                alt=""
                style={{
                  objectPosition: `${data.settings.branding.coachProfilePhotoPosition?.x ?? 50}% ${data.settings.branding.coachProfilePhotoPosition?.y ?? 50}%`,
                }}
              />
            ) : (
              (data?.settings.coachName ?? "Darius A. Journigan")
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
            )}
          </span>
          <div>
            <strong>{data?.settings.coachName ?? "Darius A. Journigan"}</strong>
            <small>{data?.settings.coachTitle ?? "Acting Coach"}</small>
          </div>
        </div>
        <SessionAction isDemo={isDemo} sidebar />
      </aside>
      <main className="main" id="main-content" tabIndex={-1}>
        <WorkspaceScrollRestoration />
        <Outlet />
      </main>
      {data && <ActivityCenter data={data} audience="coach" />}
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {coachNavigation.slice(0, 4).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === "/coach"}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
        <button
          onClick={(event) => {
            event.currentTarget.focus();
            setMoreOpen(true);
          }}
        >
          <Menu />
          <span>More</span>
        </button>
      </nav>
      {moreOpen && (
        <Dialog
          title="More"
          className="navigation-sheet"
          onClose={() => setMoreOpen(false)}
        >
          <nav className="workspace-more-group" aria-label="More destinations">
            {[...coachNavigation.slice(4), ...studioNavigation].map(
              ({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} onClick={() => setMoreOpen(false)}>
                  <Icon aria-hidden="true" />
                  {label}
                </NavLink>
              ),
            )}
            <button
              onClick={() => {
                setMoreOpen(false);
                setSearchOpen(true);
              }}
            >
              <Search aria-hidden="true" /> Search records and destinations
            </button>
            <SessionAction isDemo={isDemo} />
          </nav>
        </Dialog>
      )}
      {searchOpen && (
        <WorkspaceSearch
          audience="coach"
          destinations={[...coachNavigation, ...studioNavigation]}
          demoData={isDemo ? data : undefined}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}
