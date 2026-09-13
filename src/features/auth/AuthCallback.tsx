import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";

type AccessResult = {
  role: "coach" | "student" | "guardian";
  destination: "/coach" | "/portal";
};

function compatibleReturnPath(value: string | null, role: AccessResult["role"]) {
  if (!value?.startsWith("/") || value.startsWith("//")) return null;
  if (value === "/book" || value.startsWith("/book/")) return value;
  if (role === "coach" && (value === "/coach" || value.startsWith("/coach/"))) return value;
  if (role !== "coach" && (value === "/portal" || value.startsWith("/portal/"))) return value;
  return null;
}

export function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState(false);
  const coachLogin = params.get("returnTo")?.startsWith("/coach") ?? false;

  useEffect(() => {
    let active = true;
    const finish = async () => {
      if (!supabase) {
        if (active) setError(true);
        return;
      }
      let { data: { session } } = await supabase.auth.getSession();
      const code = params.get("code");
      if (!session && code) {
        const exchange = await supabase.auth.exchangeCodeForSession(code);
        session = exchange.data.session;
      }
      if (!session) {
        if (active) setError(true);
        return;
      }
      const response = await fetch("/api/v2/auth/claim-access", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) {
        await supabase.auth.signOut();
        if (active) setError(true);
        return;
      }
      const result = (await response.json()) as AccessResult;
      const destination = compatibleReturnPath(params.get("returnTo"), result.role) || result.destination;
      if (active) navigate(destination, { replace: true });
    };
    void finish().catch(async () => {
      await supabase?.auth.signOut();
      if (active) setError(true);
    });
    return () => { active = false; };
  }, [navigate, params]);

  if (!error) return <main className="login-page"><div className="login-card loading">Finishing your secure sign-in…</div></main>;
  return (
    <main className="login-page">
      <section className="login-card">
        <h1>We couldn’t finish sign-in</h1>
        <p>
          {coachLogin
            ? "Coach Google sign-in requires the studio coach account."
            : "Use the email saved on your student or household profile, or sign in with your portal username and password."}
        </p>
        <Link className="button-link primary" to={coachLogin ? "/coach/login" : "/login"}>Return to sign-in</Link>
      </section>
    </main>
  );
}
