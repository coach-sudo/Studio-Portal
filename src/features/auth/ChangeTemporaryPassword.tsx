import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";

export function ChangeTemporaryPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  if (!supabase) return <Navigate to="/login" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || password !== confirmation) {
      setStatus("error");
      return;
    }
    setStatus("saving");
    const { error } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false },
    });
    if (error) {
      setStatus("error");
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const response = await fetch("/api/v2/auth/password-changed", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionData.session?.access_token || ""}`,
      },
    });
    if (!response.ok) {
      setStatus("error");
      return;
    }
    navigate("/portal", { replace: true });
  }

  return (
    <main className="login-page">
      <form className="login-card login-credentials" onSubmit={submit}>
        <h1>Create your private password</h1>
        <p>
          Your temporary password worked. Replace it now with one only you
          know; your coach will not be able to view it.
        </p>
        <label>
          New password
          <input
            required
            minLength={12}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          Confirm new password
          <input
            required
            minLength={12}
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        <small>Use at least 12 characters. A passphrase is a good choice.</small>
        {status === "error" && (
          <div role="alert">
            The passwords must match and meet the requirements. Please try again.
          </div>
        )}
        <button className="primary" disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save password and enter portal"}
        </button>
      </form>
    </main>
  );
}
