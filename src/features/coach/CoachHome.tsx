import { CalendarCheck, CheckCircle2, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Recommendation } from "../../domain/model";
import { useStudio } from "../../hooks/useStudio";
import { ActionRow, EmptyState, ExplanationDialog, PageHeader, Section } from "../../components/Primitives";

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
export function CoachHome() {
  const { data, isLoading, error } = useStudio();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Recommendation>();
  if (isLoading) return <div className="loading">Preparing today’s studio…</div>;
  if (error || !data) return <div className="error-state"><strong>We couldn’t load the studio.</strong><span>{String(error ?? "Unknown error")}</span></div>;
  const today = new Date().toDateString();
  const lessons = data.lessons.filter((lesson) => new Date(lesson.startsAt).toDateString() === today && lesson.status === "scheduled");
  const [upNext, ...attention] = data.recommendations;
  return <div className="page home-page">
    <PageHeader title={`Good morning, ${data.displayName}`} action={<div className="header-actions"><button className="search-button" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}><Search />Search<kbd>⌘ K</kbd></button><button className="primary-button" onClick={() => navigate("/students?new=1")}><Plus />Add</button></div>} />
    <Section title="Up next" marked>{upNext ? <ActionRow initials={initials(upNext.title.replace(/^Review |^Write |^Complete /, ""))} title={upNext.title} detail={upNext.explanation} urgent={upNext.urgency === 5} onClick={() => setSelected(upNext)} /> : <EmptyState title="Your studio is caught up" detail="Nothing urgent needs your attention." />}</Section>
    <Section title="Today" aside={<button className="text-button" onClick={() => navigate("/today")}>View day</button>}><div className="timeline">{lessons.length ? lessons.map((lesson) => { const student = data.students.find((row) => row.id === lesson.studentId); return <button key={lesson.id} onClick={() => navigate(`/lessons?lesson=${lesson.id}`)}><time>{new Date(lesson.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><i /><div><strong>{student?.fullName}</strong><small>{lesson.topic} · {lesson.locationLabel}</small></div></button>; }) : <EmptyState title="No lessons today" detail="Use the space for prep, notes, or a proper breather." />}</div></Section>
    <Section title="Needs attention" aside={<span className="count">{attention.length}</span>}><div>{attention.slice(0, 5).map((item) => <ActionRow key={item.id} initials={initials(data.students.find((student) => student.id === item.studentId)?.fullName ?? item.title)} title={item.title} detail={item.explanation} urgent={item.urgency === 5} actionLabel="Review" onClick={() => setSelected(item)} />)}{!attention.length && <EmptyState title="You’re caught up" detail="New follow-ups will appear here with an explanation." />}</div></Section>
    <div className="sync-row"><CheckCircle2 /><div><strong>All systems ready</strong><small>Postgres is canonical; Calendar and messages use reviewable queues.</small></div><button onClick={() => navigate("/settings")}>View health</button></div>
    {selected && <ExplanationDialog title={selected.title} explanation={selected.explanation} evidence={selected.evidence} action={selected.suggestedAction} onClose={() => setSelected(undefined)} />}
  </div>;
}
