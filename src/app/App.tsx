import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { StudioStoreProvider } from "../state/StudioStore";
import { isDemoMode, isSupabaseConfigured, supabase } from "../lib/supabase";
const CoachHome=lazy(()=>import("../features/coach/CoachHome").then(module=>({default:module.CoachHome})));
const CoachSection=lazy(()=>import("../features/coach/CoachSection").then(module=>({default:module.CoachSection})));
const StudentPortal=lazy(()=>import("../features/student/StudentPortal").then(module=>({default:module.StudentPortal})));
const PublicActorPage=lazy(()=>import("../features/public/PublicActorPage").then(module=>({default:module.PublicActorPage})));
const MagicLinkLogin=lazy(()=>import("../features/auth/MagicLinkLogin").then(module=>({default:module.MagicLinkLogin})));
const PublicBooking=lazy(()=>import("../features/booking/PublicBooking").then(module=>({default:module.PublicBooking})));
const BookingCenter=lazy(()=>import("../features/coach/BookingCenter").then(module=>({default:module.BookingCenter})));
const StudentWorkspace=lazy(()=>import("../features/coach/StudentWorkspace").then(module=>({default:module.StudentWorkspace})));
const TermsPage=lazy(()=>import("../features/public/TermsPage").then(module=>({default:module.TermsPage})));

export function App() {
  return <StudioStoreProvider><AppRoutes /></StudioStoreProvider>;
}

function AppRoutes() {
  return <Suspense fallback={<div className="loading">Opening the studio…</div>}><Routes>
    <Route path="/login" element={<MagicLinkLogin />} />
    <Route path="/terms" element={<TermsPage />} />
    <Route path="/portal/*" element={<AuthGate role="portal"><StudentPortal /></AuthGate>} />
    <Route path="/student/*" element={<LegacyPortalRedirect legacyPrefix="student" />} />
    <Route path="/guardian/*" element={<LegacyPortalRedirect legacyPrefix="guardian" />} />
    <Route path="/actors/:slug" element={<PublicActorPage />} />
    <Route path="/book" element={<PublicBooking />} />
    <Route path="/book/:slug" element={<PublicBooking />} />
    <Route path="/booking/:token" element={<PublicBooking />} />
    <Route element={<AuthGate role="coach"><AppShell /></AuthGate>}>
      <Route index element={<CoachHome />} />
      <Route path="/bookings" element={<BookingCenter />} />
      <Route path="/students/:studentId/*" element={<StudentWorkspace />} />
      <Route path="/:section" element={<CoachSection />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense>;
}

function LegacyPortalRedirect({legacyPrefix}:{legacyPrefix:"student"|"guardian"}){const location=useLocation(),suffix=location.pathname.replace(new RegExp(`^/${legacyPrefix}`),"");return <Navigate to={`/portal${suffix}${location.search}`} replace/>;}

function AuthGate({role,children}:{role:"coach"|"portal";children:ReactNode}){
  const [state,setState]=useState<"checking"|"allowed"|"denied">(isSupabaseConfigured?"checking":isDemoMode?"allowed":"denied"),location=useLocation();
  useEffect(()=>{const client=supabase;if(!isSupabaseConfigured||!client)return;let active=true;const check=async()=>{const {data:{session}}=await client.auth.getSession();if(!session){if(active)setState("denied");return;}if(role==="coach"){const {data,error}=await client.from("memberships").select("id").eq("role","coach").limit(1);if(active)setState(!error&&Boolean(data?.length)?"allowed":"denied");return;}const [{data:owned,error:ownedError},{data:related,error:relatedError}]=await Promise.all([client.from("students").select("id").eq("user_id",session.user.id).limit(1),client.from("student_relationships").select("id").eq("user_id",session.user.id).limit(1)]);if(active)setState((!ownedError&&Boolean(owned?.length))||(!relatedError&&Boolean(related?.length))?"allowed":"denied");};void check();const {data}=client.auth.onAuthStateChange(()=>void check());return()=>{active=false;data.subscription.unsubscribe();};},[role]);
  if(state==="checking")return <div className="loading">Verifying secure access…</div>;
  if(state==="denied")return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace/>;
  return children;
}
