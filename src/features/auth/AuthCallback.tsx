import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";

type AccessResult = {
  role: "coach" | "student" | "guardian";
  destination: "/coach" | "/portal";
};

function compatibleReturnPath(
  value: string | null,
  role: AccessResult["role"],
) {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return null;
  if (value === "/book" || value.startsWith("/book/")) return value;
  if (role === "coach" && (value === "/coach" || value.startsWith("/coach/")))
    return value;
  if (role !== "coach" && (value === "/portal" || value.startsWith("/portal/")))
    return value;
  return null;
}

export function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string>();
  const coachLogin = params.get("returnTo")?.startsWith("/coach") ?? false;

  useEffect(() => {
    let active = true;
    const finish = async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      if (params.get("error") || hash.get("error")) {
        if (active)
          setError(
            "Google or the email provider couldn’t complete sign-in. Try email and password, or use the password link option on the sign-in page.",
          );
        return;
      }
      if (!supabase) {
        if (active)
          setError(
            "Sign-in is unavailable. Please return to sign-in and try again.",
          );
        return;
      }
      let {
        data: { session },
      } = await supabase.auth.getSession();
      const code = params.get("code");
      if (!session && code) {
        const exchange = await supabase.auth.exchangeCodeForSession(code);
        session = exchange.data.session;
      }
      if (!session) {
        if (active)
          setError(
            "The sign-in link has expired or could not be opened. Request a new link and try again.",
          );
        return;
      }
      if (!active) return;
      const response = await fetch("/api/v2/auth/claim-access", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          await supabase.auth.signOut();
          if (active)
            setError(
              "This account does not have studio access. Use the email connected to your coach or portal account.",
            );
        } else if (active)
          setError(
            "We couldn’t reach the studio. Please return to sign-in and try again.",
          );
        return;
      }
      const result = (await response.json()) as AccessResult;
      const destination =
        compatibleReturnPath(params.get("returnTo"), result.role) ||
        result.destination;
      const passwordRecovery =
        params.get("action") === "reset-password" ||
        hash.get("type") === "recovery";
      if (active)
        navigate(passwordRecovery ? "/auth/reset-password" : destination, {
          replace: true,
        });
    };
    void finish().catch(() => {
      if (active)
        setError(
          "We couldn’t complete sign-in. Check your connection and return to sign-in to try again.",
        );
    });
    return () => {
      active = false;
    };
  }, [navigate, params]);

  if (!error)
    return (
      <main className="login-page">
        <div className="login-card loading">Finishing your secure sign-in…</div>
      </main>
    );
  return (
    <main className="login-page">
      <section className="login-card">
        <h1>We couldn’t finish sign-in</h1>
        <p>{error}</p>
        <Link
          className="button-link primary"
          to={coachLogin ? "/coach/login" : "/login"}
        >
          Return to sign-in
        </Link>
      </section>
    </main>
  );
}
