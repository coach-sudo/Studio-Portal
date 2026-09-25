import { lazy, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { isDemoMode, isSupabaseConfigured, supabase } from "../lib/supabase";

const StudentPortal = lazy(() =>
  import("../features/student/StudentPortal").then((module) => ({
    default: module.StudentPortal,
  })),
);

export function RoleLanding() {
  const [destination, setDestination] = useState<string>();
  const location = useLocation();
  useEffect(() => {
    let active = true;
    const resolve = async () => {
      if (!isSupabaseConfigured || !supabase) {
        if (active) setDestination(isDemoMode ? "/coach" : "/login");
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        if (active) setDestination("/login");
        return;
      }
      const claim = await fetch("/api/v2/auth/claim-access", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (claim.ok) {
        const result = (await claim.json()) as { destination?: string };
        if (active) setDestination(result.destination || "/login");
        return;
      }
      const [{ data: coach }, { data: student }, { data: guardian }] =
        await Promise.all([
          supabase
            .from("memberships")
            .select("id")
            .eq("role", "coach")
            .limit(1),
          supabase
            .from("students")
            .select("id")
            .eq("user_id", session.user.id)
            .eq("portal_enabled", true)
            .limit(1),
          supabase
            .from("linked_contacts")
            .select("id")
            .eq("user_id", session.user.id)
            .eq("portal_enabled", true)
            .limit(1),
        ]);
      if (active)
        setDestination(
          coach?.length
            ? "/coach"
            : student?.length || guardian?.length
              ? "/portal"
              : "/login",
        );
    };
    void resolve();
    return () => {
      active = false;
    };
  }, [location.key]);
  return destination ? (
    <Navigate to={destination} replace />
  ) : (
    <div className="loading">Opening your workspace…</div>
  );
}

export function PortalRole() {
  const [role, setRole] = useState<"student" | "guardian">();
  useEffect(() => {
    let active = true;
    const resolve = async () => {
      if (!supabase) {
        if (active) setRole("student");
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const [{ data: owned }, { data: related }, { data: accounts }] =
        await Promise.all([
          supabase
            .from("students")
            .select("id")
            .eq("user_id", session.user.id)
            .eq("portal_enabled", true)
            .limit(1),
          supabase
            .from("linked_contacts")
            .select("id")
            .eq("user_id", session.user.id)
            .eq("portal_enabled", true)
            .limit(1),
          supabase
            .from("portal_accounts")
            .select("account_type")
            .eq("user_id", session.user.id),
        ]);
      const hasStudentAccount = accounts?.some(
        (account) => account.account_type === "student",
      );
      if (active)
        setRole(
          owned?.length || hasStudentAccount
            ? "student"
            : related?.length
              ? "guardian"
              : "guardian",
        );
    };
    void resolve();
    return () => {
      active = false;
    };
  }, []);
  return role ? (
    <StudentPortal role={role} />
  ) : (
    <div className="loading">Opening the right workspace…</div>
  );
}

export function AuthGate({
  role,
  children,
}: {
  role: "coach" | "portal";
  children: ReactNode;
}) {
  const [state, setState] = useState<
    "checking" | "allowed" | "login" | "role_home"
  >(isSupabaseConfigured ? "checking" : isDemoMode ? "allowed" : "login");
  const location = useLocation();
  useEffect(() => {
    const client = supabase;
    if (!isSupabaseConfigured || !client) return;
    let active = true;
    const check = async () => {
      const {
        data: { session },
      } = await client.auth.getSession();
      if (!session) {
        if (active) setState("login");
        return;
      }
      if (role === "coach") {
        const { data, error } = await client
          .from("memberships")
          .select("id")
          .eq("role", "coach")
          .limit(1);
        if (active)
          setState(!error && Boolean(data?.length) ? "allowed" : "role_home");
        return;
      }
      const [
        { data: owned, error: ownedError },
        { data: related, error: relatedError },
      ] = await Promise.all([
        client
          .from("students")
          .select("id")
          .eq("user_id", session.user.id)
          .eq("portal_enabled", true)
          .limit(1),
        client
          .from("linked_contacts")
          .select("id")
          .eq("user_id", session.user.id)
          .eq("portal_enabled", true)
          .limit(1),
      ]);
      if (active)
        setState(
          (!ownedError && Boolean(owned?.length)) ||
            (!relatedError && Boolean(related?.length))
            ? "allowed"
            : "role_home",
        );
    };
    void check();
    const { data } = client.auth.onAuthStateChange(() => void check());
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [role]);
  if (state === "checking")
    return <div className="loading">Verifying secure access…</div>;
  if (state === "login")
    return (
      <Navigate
        to={`/${role === "coach" ? "coach/login" : "login"}?returnTo=${encodeURIComponent(location.pathname)}`}
        replace
      />
    );
  if (state === "role_home") return <Navigate to="/" replace />;
  return children;
}
