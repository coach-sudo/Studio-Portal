import { CalendarDays, CircleDollarSign, Plus, Search, UserRound, Waypoints } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EmptyState, PageHeader, Section } from "../../components/Primitives";
import { formatMoney, studentBalanceMinor } from "../../domain/finance";
import { useStudio } from "../../hooks/useStudio";
import { JoinLessonBanner } from "../../components/JoinLessonBanner";
import {
  formatStudioDate,
  formatStudioTime,
  studioDateKey,
} from "../../domain/presentation";

export function CoachHome() {
  const { data, isLoading, error } = useStudio();
  const navigate = useNavigate();
  if (isLoading) return <div className="loading">Preparing your studio…</div>;
  if (error || !data) return <div className="error-state"><strong>We couldn’t load the studio.</strong><span>{String(error ?? "Unknown error")}</span></div>;
  const now = Date.now(), weekEnd = now + 7 * 86_400_000, hour = new Date(now).getHours(), greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const upcoming = data.lessons.filter((lesson) => lesson.status === "scheduled" && new Date(lesson.startsAt).getTime() >= now && new Date(lesson.startsAt).getTime() < weekEnd).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
  const activeStudents = data.students.filter((student)=>student.status === "active").length;
  const importReviewCount = new Set(data.integrationImports.filter((item)=>item.status === "needs_review").map((item)=>`${item.detectedSource}:${JSON.stringify(item.payload?.summary || item.externalId)}`)).size;
  const noteFollowupCount = data.lessons.filter((lesson)=>{const ended=new Date(lesson.endsAt).getTime();return ended<=now&&ended>=now-8*86_400_000&&!(["cancelled","late_cancelled"] as string[]).includes(lesson.status)&&!data.notes.some((note)=>note.lessonId===lesson.id&&note.status==="published");}).length;
  const todayCount = data.lessons.filter((lesson)=>lesson.status==="scheduled"&&studioDateKey(lesson.startsAt,data.settings.timezone)===studioDateKey(new Date(now),data.settings.timezone)).length;
  const reviewCount = data.materials.filter((item)=>item.approvalStatus === "pending_review").length + data.actorProfiles.filter((item)=>item.status === "review_requested").length + data.assignments.filter((item)=>item.helpRequested).length + data.bookings.filter((item)=>item.status === "needs_attention").length;
  const actionCount = todayCount + noteFollowupCount + importReviewCount + reviewCount;
  const outstanding = data.students.reduce((total,student)=>total + Math.max(0,studentBalanceMinor(student.id,data.payments)),0);
  return <div className="page home-page">
    <PageHeader title={`${greeting}, ${data.displayName}`} action={<div className="header-actions"><button className="search-button" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}><Search />Search<kbd>⌘ K</kbd></button><button className="primary-button" onClick={() => navigate("/coach/students?new=1")}><Plus />Add student</button></div>}>A clear view of the studio—not a second to-do list.</PageHeader>
    <JoinLessonBanner lessons={data.lessons} label={(lesson) => `${data.students.find((item) => item.id === lesson.studentId)?.preferredName || data.students.find((item) => item.id === lesson.studentId)?.fullName || "Student"} · ${lesson.topic}`} />
    <div className="studio-pulse-grid" aria-label="Studio overview">
      <button onClick={()=>navigate("/coach/students?status=active")}><UserRound/><span><strong>{activeStudents}</strong><small>active students</small></span></button>
      <button onClick={()=>navigate("/coach/bookings?view=calendar")}><CalendarDays/><span><strong>{upcoming.length}</strong><small>lessons in 7 days</small></span></button>
      <button onClick={()=>navigate("/coach/today#verification")}><Waypoints/><span><strong>{importReviewCount}</strong><small>imports to verify</small></span></button>
      <button onClick={()=>navigate("/coach/finance")}><CircleDollarSign/><span><strong>{formatMoney(outstanding)}</strong><small>open balances</small></span></button>
    </div>
    <button className="home-today-link" onClick={()=>navigate("/coach/today")}>
      <Waypoints />
      <span>
        <strong>{actionCount} {actionCount === 1 ? "item" : "items"} need attention today</strong>
        <small>Preparation, follow-up, verification, and approvals</small>
      </span>
      <b>Open Today</b>
    </button>
    <div className="home-dashboard-grid home-dashboard-single">
      <Section title="Coming up this week" marked aside={<button className="text-button" onClick={()=>navigate("/coach/today")}>Open Today</button>}>
        <div className="timeline">{upcoming.slice(0,6).map((lesson)=>{const student=data.students.find((item)=>item.id===lesson.studentId);return <button key={lesson.id} onClick={()=>navigate(`/coach/students/${lesson.studentId}/lessons/${lesson.id}`)}><time>{formatStudioDate(lesson.startsAt,data.settings.timezone,{weekday:"short",month:undefined,day:undefined,year:undefined})}<br/>{formatStudioTime(lesson.startsAt,data.settings.timezone)}</time><i/><div><strong>{student?.preferredName || student?.fullName || "Student"}</strong><small>{lesson.topic} · {lesson.locationLabel}</small></div></button>;})}{!upcoming.length&&<EmptyState title="The next seven days are clear" detail="New lessons appear here as soon as they are booked or verified."/>}</div>
      </Section>
    </div>
  </div>;
}
