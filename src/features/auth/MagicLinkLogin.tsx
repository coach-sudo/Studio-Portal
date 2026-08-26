import { ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import { applyStudioBranding } from "../../lib/branding";

type LoginStatus =
  | "idle"
  | "signing"
  | "sending"
  | "sent"
  | "demo"
  | "error";

export function MagicLinkLogin() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<LoginStatus>("idle");
  const [studio, setStudio] = useState<{
    name: string;
    logoUrl?: string;
    branding?: Record<string, string>;
  }>({ name: "Studio Portal" });

  useEffect(() => {
    fetch("/api/v2/public/booking/services")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload) =>
        setStudio({
          name: payload.studio.name,
          logoUrl: payload.studio.branding?.logoUrl,
          branding: payload.studio.branding,
        }),
      )
      .catch(() => undefined);
  }, []);
  useEffect(() => applyStudioBranding(studio.branding), [studio.branding]);
  useEffect(() => {
    document.title = `${studio.name} — Sign in · Coach’D`;
  }, [studio.name]);

  const safeReturn = (fallback: string) => {
    const value = params.get("returnTo");
    return value?.startsWith("/") && !value.startsWith("//") ? value : fallback;
  };

  async function passwordSignIn(event: React.FormEvent) {
    event.preventDefault();
    setStatus("signing");
    try {
      if (!supabase) {
        setStatus("demo");
        return;
      }
      const response = await fetch("/api/v2/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      const { error } = await supabase.auth.setSession({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      });
      if (error) throw error;
      window.location.assign(safeReturn(result.destination || "/portal"));
    } catch {
      setStatus("error");
    }
  }

  async function emailSignIn(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    if (!isSupabaseConfigured || !supabase) {
      setStatus("demo");
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}${safeReturn("/portal")}`,
      },
    });
    setStatus(error ? "error" : "sent");
  }

  async function googleSignIn() {
    if (!supabase) {
      setStatus("demo");
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${safeReturn("/")}`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) setStatus("error");
  }

  return (
    <main className="login-page">
      {studio.logoUrl ? (
        <img className="booking-logo" src={studio.logoUrl} alt={studio.name} />
      ) : (
        <div className="wordmark">{studio.name}</div>
      )}
      <div className="login-card">
        <UserRound />
        <h1>Sign in to {studio.name}</h1>
        <section className="login-choice coach-choice">
          <ShieldCheck />
          <div>
            <strong>Coach sign-in</strong>
            <small>Use the authorized studio Google account.</small>
          </div>
          <button type="button" onClick={() => void googleSignIn()}>
            Continue with Google
          </button>
        </section>
        <div className="login-divider">Student or guardian</div>
        <p>
          Use the username and password created with your coach. This is the
          normal way to enter your portal.
        </p>
        <form className="login-credentials" onSubmit={passwordSignIn}>
          <label>
            Username
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="your.username"
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button disabled={status === "signing"}>
            {status === "signing" ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <details className="login-recovery">
          <summary>Use an email sign-in link instead</summary>
          <form onSubmit={emailSignIn}>
            <p>
              Enter the same email address your coach has on your student
              record. We’ll send a private, expiring link.
            </p>
            <label>
              Student or guardian email
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <button disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        </details>
        {status === "sent" && (
          <div role="status">Check your inbox. The link expires automatically.</div>
        )}
        {status === "demo" && (
          <div role="status">
            <strong>Demo mode does not send email.</strong>
            <br />
            <Link to="/portal">Open student portal demo</Link>
          </div>
        )}
        {status === "error" && (
          <div role="alert">
            We couldn’t sign you in. Check your username and password, use the
            email recovery option, or contact the studio.
          </div>
        )}
        <small className="login-legal">
          By using the portal, you agree to the{" "}
          <Link to="/terms">Terms and Conditions</Link>.
        </small>
      </div>
    </main>
  );
}
