import "../../styles/public.css";
import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { PasswordInput } from "./PasswordInput";

export function ChangeTemporaryPassword({
  recovery = false,
}: {
  recovery?: boolean;
}) {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [sessionReady, setSessionReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    let active = true;
    void supabase?.auth
      .getSession()
      .then(({ data, error }) => {
        if (active) {
          setHasSession(!error && Boolean(data.session));
          setSessionReady(true);
        }
      })
      .catch(() => {
        if (active) setSessionReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!supabase) return <Navigate to="/login" replace />;
  if (!sessionReady)
    return (
      <main className="login-page">
        <div className="login-card">Checking your password link…</div>
      </main>
    );
  if (!hasSession)
    return (
      <main className="login-page">
        <section className="login-card">
          <h1>Request a new password link</h1>
          <p>
            Your link has expired or is missing. Return to sign-in and choose
            ‘Set or reset your password’.
          </p>
          <a href="/coach/login">Coach sign-in</a>
          <p>
            <a href="/login">Student or household sign-in</a>
          </p>
        </section>
      </main>
    );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || password !== confirmation) {
      setStatus("error");
      return;
    }
    setStatus("saving");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Session expired");
      const headers = {
        Authorization: `Bearer ${sessionData.session.access_token}`,
      };
      const claim = await fetch("/api/v2/auth/claim-access", {
        method: "POST",
        headers,
      });
      if (!claim.ok) throw new Error("Account access could not be verified");
      const access = (await claim.json()) as { destination: string };
      const { error } = await supabase.auth.updateUser({
        password,
        data: { must_change_password: false },
      });
      if (error) {
        setStatus("error");
        return;
      }
      const response = await fetch("/api/v2/auth/password-changed", {
        method: "POST",
        headers,
      });
      if (!response.ok) {
        setStatus("error");
        return;
      }
      navigate(access.destination, { replace: true });
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className="login-page">
      <form className="login-card login-credentials" onSubmit={submit}>
        <h1>Create your private password</h1>
        <p>
          {recovery
            ? "Choose a portal password for your existing account. Use it with your email on any device."
            : "Your temporary password worked. Replace it now with one only you know; your coach will not be able to view it."}
        </p>
        <PasswordInput
          label="New password"
          required
          minLength={12}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <PasswordInput
          label="Confirm new password"
          required
          minLength={12}
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
        <small>
          Use at least 12 characters. A passphrase is a good choice.
        </small>
        {status === "error" && (
          <div role="alert">
            We couldn’t save your password. Use matching passwords of at least
            12 characters and check your connection. If your link expired,
            request a new one.
          </div>
        )}
        <button className="primary" disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save password and sign in"}
        </button>
      </form>
    </main>
  );
}
