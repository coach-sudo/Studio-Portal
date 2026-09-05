import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { StudioStoreProvider } from "../state/StudioStore";
import { isDemoMode, isSupabaseConfigured, supabase } from "../lib/supabase";
import { InstallPrompt } from "../components/InstallPrompt";
const CoachHome=lazy(()=>import("../features/coach/CoachHome").then(module=>({default:module.CoachHome})));
const CoachSection=lazy(()=>import("../features/coach/CoachSection").then(module=>({default:module.CoachSection})));
const StudentPortal=lazy(()=>import("../features/student/StudentPortal").then(module=>({default:module.StudentPortal})));
const PublicActorPage=lazy(()=>import("../features/public/PublicActorPage").then(module=>({default:module.PublicActorPage})));
const MagicLinkLogin=lazy(()=>import("../features/auth/MagicLinkLogin").then(module=>({default:module.MagicLinkLogin})));
const AuthCallback=lazy(()=>import("../features/auth/AuthCallback").then(module=>({default:module.AuthCallback})));
const ChangeTemporaryPassword=lazy(()=>import("../features/auth/ChangeTemporaryPassword").then(module=>({default:module.ChangeTemporaryPassword})));
const PublicBooking=lazy(()=>import("../features/booking/PublicBooking").then(module=>({default:module.PublicBooking})));
const BookingCenter=lazy(()=>import("../features/coach/BookingCenter").then(module=>({default:module.BookingCenter})));
const StudentWorkspace=lazy(()=>import("../features/coach/StudentWorkspace").then(module=>({default:module.StudentWorkspace})));
const TermsPage=lazy(()=>import("../features/public/TermsPage").then(module=>({default:module.TermsPage})));
const PackageGift=lazy(()=>import("../features/public/PackageGift"));
const PackageLanding=lazy(()=>import("../features/public/PackageLanding"));
const CoachClassWorkspace=lazy(()=>import("../features/classes/ClassWorkspace").then(module=>({default:module.CoachClassWorkspace})));
const CoachInbox=lazy(()=>import("../features/messages/Inbox").then(module=>({default:module.CoachInbox})));

export function App() {
  return <StudioStoreProvider><AppRoutes /><InstallPrompt /></StudioStoreProvider>;
}

function AppRoutes() {
  return <Suspense fallback={<div className="loading">Opening the studio…</div>}><Routes>
    <Route path="/login" element={<MagicLinkLogin />} />
    <Route path="/auth/callback" element={<AuthCallback />} />
    <Route path="/change-password" element={<AuthGate role="portal"><ChangeTemporaryPassword /></AuthGate>} />
    <Route path="/terms" element={<TermsPage />} />
    <Route path="/gift/thanks" element={<main className="gift-page"><section className="gift-card gift-success"><h1>Your gift purchase is confirmed</h1><p>Delivery is being prepared for the recipient. You will also receive a Stripe receipt.</p><a className="button-link primary" href="/book">Return to booking</a></section></main>} />
    <Route path="/gift/claim/:token" element={<PackageGift />} />
    <Route path="/gift/:definitionId" element={<PackageGift />} />
    <Route path="/package/:definitionId" element={<PackageLanding />} />
    <Route path="/portal/*" element={<AuthGate role="portal"><PortalRole /></AuthGate>} />
    <Route path="/student/*" element={<LegacyPortalRedirect legacyPrefix="student" />} />
    <Route path="/guardian/*" element={<LegacyPortalRedirect legacyPrefix="guardian" />} />
    <Route path="/actors/:slug" element={<PublicActorPage />} />
    <Route path="/book" element={<PublicBooking />} />
    <Route path="/book/:slug" element={<PublicBooking />} />
    <Route path="/booking/:token" element={<PublicBooking />} />
    <Route path="/coach" element={<AuthGate role="coach"><AppShell /></AuthGate>}>
      <Route index element={<CoachHome />} />
      <Route path="bookings" element={<BookingCenter />} />
      <Route path="students/:studentId/*" element={<StudentWorkspace />} />
      <Route path="inbox" element={<CoachInbox />} />
      <Route path="classes/:offeringId" element={<CoachClassWorkspace />} />
      <Route path="lessons" element={<Navigate to="/coach/bookings?view=calendar" replace />} />
      <Route path="notes" element={<Navigate to="/coach/today" replace />} />
      <Route path=":section" element={<CoachSection />} />
    </Route>
    <Route path="/" element={<RoleLanding />} />
    {['today','bookings','students','inbox','lessons','notes','materials','finance','actor-pages','settings'].map((section)=><Route key={section} path={`/${section}/*`} element={<LegacyCoachRedirect section={section} />} />)}
    <Route path="*" element={<Navigate to="/login" replace />} />
  </Routes></Suspense>;
}

function LegacyPortalRedirect({legacyPrefix}:{legacyPrefix:"student"|"guardian"}){const location=useLocation(),suffix=location.pathname.replace(new RegExp(`^/${legacyPrefix}`),"");return <Navigate to={`/portal${suffix}${location.search}`} replace/>;}

function LegacyCoachRedirect({section}:{section:string}){const location=useLocation(),suffix=location.pathname.replace(new RegExp(`^/${section}`),"");return <Navigate to={`/coach/${section}${suffix}${location.search}`} replace/>;}

function RoleLanding(){
  const [destination,setDestination]=useState<string>(),location=useLocation();
  useEffect(()=>{let active=true;const resolve=async()=>{if(!isSupabaseConfigured||!supabase){if(active)setDestination(isDemoMode?"/coach":"/login");return;}const {data:{session}}=await supabase.auth.getSession();if(!session){if(active)setDestination("/login");return;}const claim=await fetch("/api/v2/auth/claim-access",{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`}});if(claim.ok){const result=await claim.json() as {destination?:string};if(active)setDestination(result.destination||"/login");return;}const [{data:coach},{data:student},{data:guardian}]=await Promise.all([supabase.from("memberships").select("id").eq("role","coach").limit(1),supabase.from("students").select("id").eq("user_id",session.user.id).eq("portal_enabled",true).limit(1),supabase.from("linked_contacts").select("id").eq("user_id",session.user.id).eq("portal_enabled",true).limit(1)]);if(active)setDestination(coach?.length?"/coach":student?.length||guardian?.length?"/portal":"/login");};void resolve();return()=>{active=false;};},[location.key]);
  return destination?<Navigate to={destination} replace/>:<div className="loading">Opening your workspace…</div>;
}

function PortalRole(){
  const [role,setRole]=useState<"student"|"guardian">();
  useEffect(()=>{let active=true;const resolve=async()=>{
    if(!supabase){if(active)setRole("student");return;}
    const {data:{session}}=await supabase.auth.getSession();
    if(!session)return;
    const [{data:owned},{data:related},{data:accounts}]=await Promise.all([
      supabase.from("students").select("id").eq("user_id",session.user.id).eq("portal_enabled",true).limit(1),
      supabase.from("linked_contacts").select("id").eq("user_id",session.user.id).eq("portal_enabled",true).limit(1),
      supabase.from("portal_accounts").select("account_type").eq("user_id",session.user.id),
    ]);
    const hasStudentAccount=accounts?.some((account)=>account.account_type==="student");
    if(active)setRole(owned?.length||hasStudentAccount?"student":related?.length?"guardian":"guardian");
  };void resolve();return()=>{active=false;};},[]);
  return role?<StudentPortal role={role}/>:<div className="loading">Opening the right workspace…</div>;
}

function AuthGate({role,children}:{role:"coach"|"portal";children:ReactNode}){
  const [state,setState]=useState<"checking"|"allowed"|"login"|"role_home">(isSupabaseConfigured?"checking":isDemoMode?"allowed":"login"),location=useLocation();
  useEffect(()=>{const client=supabase;if(!isSupabaseConfigured||!client)return;let active=true;const check=async()=>{const {data:{session}}=await client.auth.getSession();if(!session){if(active)setState("login");return;}if(role==="coach"){const {data,error}=await client.from("memberships").select("id").eq("role","coach").limit(1);if(active)setState(!error&&Boolean(data?.length)?"allowed":"role_home");return;}const [{data:owned,error:ownedError},{data:related,error:relatedError}]=await Promise.all([client.from("students").select("id").eq("user_id",session.user.id).eq("portal_enabled",true).limit(1),client.from("linked_contacts").select("id").eq("user_id",session.user.id).eq("portal_enabled",true).limit(1)]);if(active)setState((!ownedError&&Boolean(owned?.length))||(!relatedError&&Boolean(related?.length))?"allowed":"role_home");};void check();const {data}=client.auth.onAuthStateChange(()=>void check());return()=>{active=false;data.subscription.unsubscribe();};},[role]);
  if(state==="checking")return <div className="loading">Verifying secure access…</div>;
  if(state==="login")return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace/>;
  if(state==="role_home")return <Navigate to="/" replace/>;
  return children;
}
