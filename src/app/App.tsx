import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { StudioStoreProvider } from "../state/StudioStore";
import { InstallPrompt } from "../components/InstallPrompt";
const AuthGate=lazy(()=>import("./AuthRoutes").then(module=>({default:module.AuthGate})));
const PortalRole=lazy(()=>import("./AuthRoutes").then(module=>({default:module.PortalRole})));
const RoleLanding=lazy(()=>import("./AuthRoutes").then(module=>({default:module.RoleLanding})));
const CoachHome=lazy(()=>import("../features/coach/CoachHome").then(module=>({default:module.CoachHome})));
const AppShell=lazy(()=>import("../components/AppShell").then(module=>({default:module.AppShell})));
const CoachSection=lazy(()=>import("../features/coach/CoachSection").then(module=>({default:module.CoachSection})));
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
const Campaigns=lazy(()=>import("../features/coach/Campaigns").then(module=>({default:module.Campaigns})));
const CoachReferrals=lazy(()=>import("../features/referrals/Referrals").then(module=>({default:module.CoachReferrals})));

export function App() {
  return <StudioStoreProvider><AppRoutes /><InstallPrompt /></StudioStoreProvider>;
}

function AppRoutes() {
  return <Suspense fallback={<div className="loading">Opening the studio…</div>}><Routes>
    <Route path="/login" element={<MagicLinkLogin />} />
    <Route path="/coach/login" element={<MagicLinkLogin coachOnly />} />
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
      <Route path="campaigns" element={<Campaigns />} />
      <Route path="referrals" element={<CoachReferrals />} />
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
