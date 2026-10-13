import "../../styles/public.css";
import { UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { readApiClientError } from "../../data/apiClientError";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import { applyStudioBranding } from "../../lib/branding";
import { PasswordInput } from "./PasswordInput";

type LoginStatus =
  "idle" | "signing" | "sending" | "sent" | "reset" | "demo" | "error";

export function MagicLinkLogin({ coachOnly = false }: { coachOnly?: boolean }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<LoginStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const busy = status === "signing" || status === "sending";
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
    return value?.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("\\")
      ? value
      : fallback;
  };

  async function passwordSignIn(event: React.FormEvent) {
    event.preventDefault();
    setStatus("signing");
    setErrorMessage(
      "Check your email or username and password. If you haven’t set a password yet, use ‘Set or reset your password’ below.",
    );
    try {
      if (!supabase) {
        setStatus("demo");
        return;
      }
      const response = await fetch("/api/v2/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!response.ok)
        throw await readApiClientError(
          response,
          "Sign-in could not be completed.",
        );
      const result = await response.json();
      const { error } = await supabase.auth.setSession({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      });
      if (error) throw error;
      // The server chooses the role and enforces the first-login password change.
      const destination = result.destination || "/portal";
      const requested = safeReturn(destination);
      const allowedReturn =
        requested === "/book" ||
        requested.startsWith("/book/") ||
        requested === destination ||
        requested.startsWith(`${destination}/`);
      navigate(
        destination === "/change-password" || !allowedReturn
          ? destination
          : requested,
        { replace: true },
      );
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
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?returnTo=${encodeURIComponent(safeReturn("/portal"))}`,
        },
      });
      if (error) throw error;
      setStatus("sent");
    } catch {
      setErrorMessage(
        "We couldn’t send the sign-in link. Check your connection and try again shortly.",
      );
      setStatus("error");
    }
  }

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) {
      setStatus("demo");
      return;
    }
    setStatus("sending");
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("returnTo", coachOnly ? "/coach" : "/portal");
    callback.searchParams.set("action", "reset-password");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: callback.toString() },
      );
      if (error) throw error;
      setStatus("reset");
    } catch {
      setErrorMessage(
        "We couldn’t send the password email. Check your connection and try again shortly.",
      );
      setStatus("error");
    }
  }

  async function googleSignIn() {
    if (!supabase) {
      setStatus("demo");
      return;
    }
    setStatus("signing");
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("returnTo", safeReturn("/coach"));
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: callback.toString(),
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch {
      setErrorMessage(
        "Google sign-in couldn’t start. Try email and password, or set a password below.",
      );
      setStatus("error");
    }
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
        <h1>{coachOnly ? "Coach sign-in" : "Student and household sign-in"}</h1>
        {coachOnly ? (
          <>
            <p>
              Google sign-in is available only to the studio coach account. You
              can also use that account’s email and a portal password.
            </p>
            <section className="login-choice google-choice">
              <span className="google-mark" aria-hidden="true">
                G
              </span>
              <div>
                <strong>Coach Google sign-in</strong>
                <small>Use the studio coach Google account.</small>
              </div>
              <button
                type="button"
                aria-label="Continue with Google"
                disabled={busy}
                onClick={() => void googleSignIn()}
              >
                {status === "signing" ? "Opening…" : "Continue"}
              </button>
            </section>
          </>
        ) : (
          <>
            <p>
              Students, guardians, and support people can use their email or the
              username and password from their portal invitation.
            </p>
          </>
        )}
        <form className="login-credentials" onSubmit={passwordSignIn}>
          <label>
            {coachOnly ? "Email" : "Email or username"}
            <input
              required
              type={coachOnly ? "email" : "text"}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={
                coachOnly
                  ? "you@example.com"
                  : "you@example.com or your.username"
              }
            />
          </label>
          <label>
            Password
            <PasswordInput
              aria-label="Password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button disabled={busy}>
            {status === "signing" ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <details className="login-recovery">
          <summary>Set or reset your password</summary>
          <form onSubmit={resetPassword}>
            <p>
              {coachOnly
                ? "Use the same email as your coach Google account. This adds a portal password to your existing account."
                : "Use the email on your portal account."}{" "}
              We’ll email a secure link to choose a password.
            </p>
            <label>
              Account email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <button disabled={busy}>
              {status === "sending" ? "Sending…" : "Email password link"}
            </button>
          </form>
        </details>
        {!coachOnly && (
          <details className="login-recovery">
            <summary>Use an email sign-in link instead</summary>
            <form onSubmit={emailSignIn}>
              <p>
                Enter the same email address your coach has on your student
                record. We’ll send a private, expiring link.
              </p>
              <label>
                Profile email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <button disabled={busy}>
                {status === "sending" ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
          </details>
        )}
        <p>
          <Link to={coachOnly ? "/login" : "/coach/login"}>
            {coachOnly ? "Student or household login" : "Coach login"}
          </Link>
        </p>
        {status === "reset" && (
          <div role="status">
            If that email belongs to an account, a password link is on its way.
            Check your inbox and spam folder, then open the link to choose your
            password.
          </div>
        )}
        {status === "sent" && (
          <div role="status">
            Check your inbox. The link expires automatically.
          </div>
        )}
        {status === "demo" && (
          <div role="status">
            <strong>Demo mode does not send email.</strong>
            <br />
            <Link to="/portal">Open student portal demo</Link>
          </div>
        )}
        {status === "error" && <div role="alert">{errorMessage}</div>}
        <small className="login-legal">
          By using the portal, you agree to the{" "}
          <Link to="/terms">Terms and Conditions</Link>.
        </small>
      </div>
    </main>
  );
}
