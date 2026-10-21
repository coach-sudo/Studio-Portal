import { LogIn, LogOut } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "./IdentityActions.css";

export function SessionAction({
  isDemo,
  sidebar = false,
}: {
  isDemo: boolean;
  sidebar?: boolean;
}) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const label = isDemo ? "Log in" : "Log out";
  const Icon = isDemo ? LogIn : LogOut;

  async function handleClick() {
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      if (!isDemo) {
        if (!supabase) throw new Error("Authentication unavailable");
        const result = await supabase.auth.signOut();
        if (result.error) throw result.error;
      }
      navigate("/login", { replace: true });
    } catch {
      setError(true);
      setPending(false);
    }
  }

  return (
    <div
      className={sidebar ? "session-action sidebar-session" : "session-action"}
    >
      <button
        type="button"
        className="session-button"
        onClick={handleClick}
        disabled={pending}
        title={label}
        aria-label={label}
      >
        <Icon aria-hidden="true" />
        <span>{pending ? "Logging out…" : label}</span>
      </button>
      {error && <small role="alert">Couldn’t log out. Please try again.</small>}
    </div>
  );
}
