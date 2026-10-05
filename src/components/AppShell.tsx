import {
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useStudioRoute } from "../hooks/useStudio";
import { applyStudioBranding } from "../lib/branding";
import { Dialog } from "./Primitives";
import { ActivityCenter } from "./ActivityCenter";
import { coachNavigation } from "../app/coachNavigation";
import { useSidebarCollapse } from "../hooks/useSidebarCollapse";
import { supabase } from "../lib/supabase";
import "./IdentityActions.css";

export function AppShell() {
  const { data } = useStudioRoute("coach", undefined, ["identity"]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const destinations = coachNavigation.filter(({ label }) =>
    label.toLowerCase().includes(query.toLowerCase()),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useSidebarCollapse();
  const navigate = useNavigate();
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
      <aside className="sidebar">
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
          onClick={() => {
            setQuery("");
            setSearchOpen(true);
          }}
          aria-label="Search studio workflows"
        >
          <Search aria-hidden="true" />
          <span>Find a workflow</span>
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
          <button
            type="button"
            className="identity-signout"
            aria-label="Sign out"
            onClick={async () => {
              await supabase?.auth.signOut();
              navigate("/login", { replace: true });
            }}
          >
            <LogOut aria-hidden="true" />
          </button>
        </div>
      </aside>
      <main className="main" id="main-content" tabIndex={-1}>
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
        <button onClick={() => setSearchOpen(true)}>
          <Menu />
          <span>More</span>
        </button>
      </nav>
      {searchOpen && (
        <Dialog
          title="Go to"
          description="Find your next studio workflow."
          onClose={() => setSearchOpen(false)}
        >
          <div className="command-search">
            <label>
              <Search aria-hidden="true" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a workflow…"
                aria-label="Find a workflow"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && destinations[0]) {
                    navigate(destinations[0].to);
                    setSearchOpen(false);
                  }
                }}
              />
            </label>
            <div>
              {destinations.map(({ to, label, icon: Icon }) => (
                <button
                  key={to}
                  onClick={() => {
                    navigate(to);
                    setSearchOpen(false);
                  }}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
              {!destinations.length && (
                <p role="status">
                  No workflows match. Try a page name like Students or Bookings.
                </p>
              )}
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
