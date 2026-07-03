import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/AppShell";
const CoachHome=lazy(()=>import("../features/coach/CoachHome").then(module=>({default:module.CoachHome})));
const CoachSection=lazy(()=>import("../features/coach/CoachSection").then(module=>({default:module.CoachSection})));
const StudentPortal=lazy(()=>import("../features/student/StudentPortal").then(module=>({default:module.StudentPortal})));
const PublicActorPage=lazy(()=>import("../features/public/PublicActorPage").then(module=>({default:module.PublicActorPage})));
const MagicLinkLogin=lazy(()=>import("../features/auth/MagicLinkLogin").then(module=>({default:module.MagicLinkLogin})));

export function App() {
  return <Suspense fallback={<div className="loading">Opening the studio…</div>}><Routes>
    <Route path="/login" element={<MagicLinkLogin />} />
    <Route path="/portal/*" element={<StudentPortal />} />
    <Route path="/actors/:slug" element={<PublicActorPage />} />
    <Route element={<AppShell />}>
      <Route index element={<CoachHome />} />
      <Route path="/:section" element={<CoachSection />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense>;
}
