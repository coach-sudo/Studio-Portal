import { CalendarDays, CircleDollarSign, Plus, Search, UserRound, Waypoints } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EmptyState, PageHeader, Section, Status } from "../../components/Primitives";
import { formatMoney, studentBalanceMinor } from "../../domain/finance";
import { useStudio } from "../../hooks/useStudio";

export function CoachHome() {
  const { data, isLoading, error } = useStudio();
  const navigate = useNavigate();
  if (isLoading) return <div className="loading">Preparing your studio…</div>;
  if (error || !data) return <div className="error-state"><strong>We couldn’t load the studio.</strong><span>{String(error ?? "Unknown error")}</span></div>;
  const now = Date.now(), weekEnd = now + 7 * 86_400_000, hour = new Date(now).getHours(), greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const upcoming = data.lessons.filter((lesson) => lesson.status === "scheduled" && new Date(lesson.startsAt).getTime() >= now && new Date(lesson.startsAt).getTime() < weekEnd).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
  const activeStudents = data.students.filter((student)=>student.status === "active").length;
  const reviewCount = data.integrationImports.filter((item)=>item.status === "needs_review").length;
  const outstanding = data.students.reduce((total,student)=>total + Math.max(0,studentBalanceMinor(student.id,data.payments)),0);
  const attention = data.recommendations.slice(0,5);
  return <div className="page home-page">
    <PageHeader title={`${greeting}, ${data.displayName}`} action={<div className="header-actions"><button className="search-button" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}><Search />Search<kbd>⌘ K</kbd></button><button className="primary-button" onClick={() => navigate("/coach/students?new=1")}><Plus />Add student</button></div>}>A clear view of the studio—not a second to-do list.</PageHeader>
    <div className="studio-pulse-grid" aria-label="Studio overview">
      <button onClick={()=>navigate("/coach/students?status=active")}><UserRound/><span><strong>{activeStudents}</strong><small>active students</small></span></button>
      <button onClick={()=>navigate("/coach/lessons")}><CalendarDays/><span><strong>{upcoming.length}</strong><small>lessons in 7 days</small></span></button>
      <button onClick={()=>navigate("/coach/today#verification")}><Waypoints/><span><strong>{reviewCount}</strong><small>imports to verify</small></span></button>
      <button onClick={()=>navigate("/coach/finance")}><CircleDollarSign/><span><strong>{formatMoney(outstanding)}</strong><small>open balances</small></span></button>
    </div>
    <div className="home-dashboard-grid">
      <Section title="Coming up this week" marked aside={<button className="text-button" onClick={()=>navigate("/coach/today")}>Run today</button>}>
        <div className="timeline">{upcoming.slice(0,6).map((lesson)=>{const student=data.students.find((item)=>item.id===lesson.studentId);return <button key={lesson.id} onClick={()=>navigate(`/coach/students/${lesson.studentId}/lessons/${lesson.id}`)}><time>{new Date(lesson.startsAt).toLocaleDateString([],{weekday:"short"})}<br/>{new Date(lesson.startsAt).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}</time><i/><div><strong>{student?.preferredName || student?.fullName || "Student"}</strong><small>{lesson.topic} · {lesson.locationLabel}</small></div></button>;})}{!upcoming.length&&<EmptyState title="The next seven days are clear" detail="New lessons appear here as soon as they are booked or verified."/>}</div>
      </Section>
      <Section title="Studio attention" aside={<span className="count">{data.recommendations.length}</span>}>
        <div className="table-list compact-list">{attention.map((item)=><article key={item.id}><Waypoints/><div><strong>{item.title}</strong><small>{item.explanation}</small></div><Status tone={item.urgency>=4?"warn":"neutral"}>{item.urgency>=4?"priority":"review"}</Status><button onClick={()=>navigate(item.reasonCode.includes("note")?"/coach/notes":item.reasonCode.includes("package")?"/coach/finance":item.entityType==="booking"?"/coach/bookings":"/coach/today")}>Open</button></article>)}{!attention.length&&<EmptyState title="The studio is caught up" detail="Cross-studio issues and opportunities appear here."/>}</div>
      </Section>
    </div>
  </div>;
}
