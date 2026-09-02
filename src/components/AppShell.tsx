import { Menu, Search } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useStudio } from "../hooks/useStudio";
import { applyStudioBranding } from "../lib/branding";
import { ActivityCenter } from "./ActivityCenter";
import { coachNavigation } from "../app/navigation";

export function AppShell() {
  const { data } = useStudio();
  const [searchOpen, setSearchOpen] = useState(false);
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
    <div className="app-shell">
      <aside className="sidebar">
        <div className="shell-brand">
          {data?.settings.branding?.logoUrl && <img src={data.settings.branding.logoUrl} alt="" />}
          <div className="wordmark">{data?.settings.studioName ?? "Coach’D"}</div>
        </div>
        <nav aria-label="Coach navigation">
          {coachNavigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/coach"}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="identity">
          <span className={data?.settings.branding.coachProfilePhotoUrl ? "has-photo" : ""}>
            {data?.settings.branding.coachProfilePhotoUrl ? <img src={data.settings.branding.coachProfilePhotoUrl} alt="" style={{objectPosition:`${data.settings.branding.coachProfilePhotoPosition?.x ?? 50}% ${data.settings.branding.coachProfilePhotoPosition?.y ?? 50}%`}}/> : (data?.settings.coachName ?? "Darius A. Journigan")
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)}
          </span>
          <div>
            <strong>{data?.settings.coachName ?? "Darius A. Journigan"}</strong>
            <small>{data?.settings.coachTitle ?? "Acting Coach"}</small>
          </div>
        </div>
      </aside>
      <main className="main">
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
        <div
          className="dialog-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setSearchOpen(false)
          }
        >
          <section
            className="command-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Go to"
          >
            <header>
              <Search />
              <input
                autoFocus
                placeholder="Find a workflow…"
                aria-label="Find a workflow"
                onKeyDown={(event) => {
                  const match = coachNavigation.find(
                    ({ label }) =>
                      label.toLowerCase() ===
                      event.currentTarget.value.toLowerCase(),
                  );
                  if (event.key === "Enter" && match) {
                    navigate(match.to);
                    setSearchOpen(false);
                  }
                  if (event.key === "Escape") setSearchOpen(false);
                }}
              />
            </header>
            {coachNavigation.map(({ to, label, icon: Icon }) => (
              <button
                key={to}
                onClick={() => {
                  navigate(to);
                  setSearchOpen(false);
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
