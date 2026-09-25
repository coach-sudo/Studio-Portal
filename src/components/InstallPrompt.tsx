import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
const hiddenKey = "coachd-install-prompt-complete";
const visitsKey = "coachd-install-eligible-visits";
const sessionCountedKey = "coachd-install-session-counted";
const suppressedRoute =
  /^\/(?:login|coach\/login|auth|change-password|book(?:\/|$)|booking(?:\/|$)|gift(?:\/|$)|package(?:\/|$)|portal\/payments(?:\/|$))/;

export function recordEligiblePwaSession(
  persistent: Pick<Storage, "getItem" | "setItem">,
  session: Pick<Storage, "getItem" | "setItem">,
) {
  if (!session.getItem(sessionCountedKey)) {
    const visits = Number(persistent.getItem(visitsKey) || 0) + 1;
    persistent.setItem(visitsKey, String(visits));
    session.setItem(sessionCountedKey, "1");
  }
  return Number(persistent.getItem(visitsKey) || 0);
}

export function isPwaPromptRoute(pathname: string) {
  return (
    /^\/(?:coach|portal)(?:\/|$)/.test(pathname) &&
    !suppressedRoute.test(pathname)
  );
}

export function InstallPrompt() {
  const location = useLocation();
  const [event, setEvent] = useState<InstallEvent>();
  const [eligible, setEligible] = useState(false);
  useEffect(() => {
    if (localStorage.getItem(hiddenKey)) return;
    const ready = (incoming: Event) => {
      incoming.preventDefault();
      setEvent(incoming as InstallEvent);
    };
    const installed = () => {
      localStorage.setItem(hiddenKey, "installed");
      setEvent(undefined);
    };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const evaluate = async () => {
      if (!isPwaPromptRoute(location.pathname)) {
        if (active) setEligible(false);
        return;
      }
      const { isDemoMode, isSupabaseConfigured, supabase } = await import(
        "../lib/supabase"
      );
      const authenticated =
        isDemoMode ||
        (!isSupabaseConfigured
          ? false
          : Boolean((await supabase?.auth.getSession())?.data.session));
      if (!authenticated) {
        if (active) setEligible(false);
        return;
      }
      if (active)
        setEligible(
          recordEligiblePwaSession(localStorage, sessionStorage) >= 3,
        );
    };
    void evaluate();
    return () => {
      active = false;
    };
  }, [location.pathname]);
  useEffect(() => {
    if (event && eligible)
      document.documentElement.dataset.installPrompt = "open";
    else delete document.documentElement.dataset.installPrompt;
    return () => {
      delete document.documentElement.dataset.installPrompt;
    };
  }, [eligible, event]);
  if (!event || !eligible) return null;
  const dismiss = () => {
    localStorage.setItem(hiddenKey, "dismissed");
    setEvent(undefined);
  };
  const install = async () => {
    await event.prompt();
    const choice = await event.userChoice;
    localStorage.setItem(hiddenKey, choice.outcome);
    setEvent(undefined);
  };
  return (
    <aside
      className="install-prompt"
      aria-label="Add Coach’D to your home screen"
    >
      <Download />
      <div>
        <strong>Add Coach’D to your home screen</strong>
        <small>
          Open the app from this device. An internet connection is still
          required.
        </small>
      </div>
      <button className="primary-button" onClick={() => void install()}>
        Add
      </button>
      <button aria-label="Dismiss install prompt" onClick={dismiss}>
        <X />
      </button>
    </aside>
  );
}
