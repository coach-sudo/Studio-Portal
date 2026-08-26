import {
  CalendarCheck2,
  CalendarDays,
  Clapperboard,
  FolderOpen,
  Home,
  Menu,
  Search,
  Settings,
  Users,
  WalletCards,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useStudio } from "../hooks/useStudio";
import { applyStudioBranding } from "../lib/branding";

const nav = [
  ["/coach", "Home", Home],
  ["/coach/today", "Today", CalendarDays],
  ["/coach/bookings", "Bookings", CalendarCheck2],
  ["/coach/students", "Students", Users],
  ["/coach/materials", "Materials", FolderOpen],
  ["/coach/finance", "Payments", WalletCards],
  ["/coach/actor-pages", "Actor Pages", Clapperboard],
  ["/coach/settings", "Settings", Settings],
] as const;

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
          <div className="wordmark">{data?.settings.studioName ?? "Studio"}</div>
        </div>
        <nav aria-label="Coach navigation">
          {nav.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === "/coach"}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="identity">
          <span>
            {(data?.settings.coachName ?? "Darius A. Journigan")
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
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {nav.slice(0, 4).map(([to, label, Icon]) => (
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
                  const match = nav.find(
                    ([, label]) =>
                      label.toLowerCase() ===
                      event.currentTarget.value.toLowerCase(),
                  );
                  if (event.key === "Enter" && match) {
                    navigate(match[0]);
                    setSearchOpen(false);
                  }
                  if (event.key === "Escape") setSearchOpen(false);
                }}
              />
            </header>
            {nav.map(([to, label, Icon]) => (
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
