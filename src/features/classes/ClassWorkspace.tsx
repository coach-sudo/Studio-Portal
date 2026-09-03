import { CalendarDays, CheckSquare, MessageSquare, Users, Video } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState, PageHeader, Section, Status } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import type { Role, StudioSnapshot } from "../../domain/model";
import { formatStudioDateTime } from "../../domain/presentation";
import { useStudio } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

export function CoachClassWorkspace() {
  const { offeringId = "" } = useParams();
  const { data, isLoading, isDemo } = useStudio();
  if (isLoading || !data) return <div className="loading">Opening class…</div>;
  return <ClassWorkspace data={data} isDemo={isDemo} role="coach" offeringId={offeringId} />;
}

export function PortalClassWorkspace({ data, isDemo, role }: { data: StudioSnapshot; isDemo: boolean; role: Extract<Role, "student" | "guardian"> }) {
  const { offeringId = "" } = useParams();
  return <ClassWorkspace data={data} isDemo={isDemo} role={role} offeringId={offeringId} />;
}

function ClassWorkspace({ data, isDemo, role, offeringId }: { data: StudioSnapshot; isDemo: boolean; role: Role; offeringId: string }) {
  const offering = data.serviceOfferings.find((item) => item.id === offeringId)!;
  const queryClient = useQueryClient();
  const store = useStudioStore();
  const [message, setMessage] = useState("");
  const [messageBusy, setMessageBusy] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignment, setAssignment] = useState({ title: "", details: "", dueAt: "" });
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const coach = role === "coach";
  if (!offering) return <Navigate to={coach ? "/coach/bookings?view=classes" : "/portal/bookings"} replace />;
  const service = data.bookingServices.find((item) => item.id === offering.serviceId);
  const lessons = data.lessons.filter((item) => offering.lessonIds.includes(item.id));
  const participants = [...new Map(data.lessonParticipants.filter((item) => offering.lessonIds.includes(item.lessonId)).map((item) => [item.studentId || item.email, item])).values()];
  const assignments = data.assignments.filter((item) => item.lessonId && offering.lessonIds.includes(item.lessonId));
  const assignmentGroups = [...new Map(assignments.map((item) => [`${item.title}:${item.details}:${item.dueAt || ""}`, item])).values()];
  const messages = data.offeringMessages.filter((item) => item.offeringId === offering.id);
  const joinUrl = offering.meetingUrl || lessons.find((item) => item.joinUrl)?.joinUrl;

  async function postMessage(event: FormEvent) {
    event.preventDefault();
    const body = message.trim();
    if (!body || messageBusy) return;
    setMessageBusy(true);
    setNotice("");
    try {
      if (isDemo) {
        store.transact((draft) => draft.offeringMessages.push({ id: `offering-message-${crypto.randomUUID()}`, studioId: offering.studioId, offeringId: offering.id, authorRole: coach ? "coach" : role as "student" | "guardian", authorName: data.displayName, body, createdAt: new Date().toISOString() }));
      } else {
        await studioCommand("offerings", { command: "post_message", entityId: offering.id, expectedVersion: offering.version, payload: { body }, reason: "Class message posted" });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setMessage("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The class message could not be posted.");
    } finally {
      setMessageBusy(false);
    }
  }

  async function createAssignment(event: FormEvent) {
    event.preventDefault();
    if (assignmentBusy) return;
    setAssignmentBusy(true);
    setNotice("");
    try {
      if (isDemo) {
        store.transact((draft) => {
          for (const participant of participants) if (participant.studentId) draft.assignments.push({ id: `assignment-${crypto.randomUUID()}`, version: 1, updatedAt: new Date().toISOString(), studentId: participant.studentId, lessonId: offering.lessonIds[0], title: assignment.title, details: assignment.details, dueAt: assignment.dueAt || undefined, status: "assigned", helpRequested: false, activityType: "instruction", activityConfig: {}, responses: {} });
        });
      } else {
        await studioCommand("offerings", { command: "create_assignment", entityId: offering.id, expectedVersion: offering.version, payload: { title: assignment.title, details: assignment.details, dueAt: assignment.dueAt || undefined }, reason: "Coach assigned class work" });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setAssignment({ title: "", details: "", dueAt: "" });
      setAssignmentOpen(false);
      setNotice("Assignment shared with the class.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The class assignment could not be created.");
    } finally {
      setAssignmentBusy(false);
    }
  }

  return <div className={coach ? "page class-workspace" : "student-page class-workspace"}>
    <PageHeader title={offering.title} action={<div className="header-actions">{joinUrl && <a className="button-link primary" href={joinUrl} target="_blank" rel="noreferrer"><Video />Join class</a>}<Link className="button-link" to={coach ? "/coach/bookings?view=classes" : "/portal/bookings"}>Back to schedule</Link></div>}>
      {service?.name || "Group class"} · {formatStudioDateTime(offering.startsAt, data.settings.timezone)}
    </PageHeader>
    {notice && <p className="portal-notice" role="status">{notice}</p>}
    <div className="class-summary-grid">
      <article><CalendarDays /><span><small>Starts</small><strong>{formatStudioDateTime(offering.startsAt, data.settings.timezone)}</strong></span></article>
      <article><Users /><span><small>Enrollment</small><strong>{offering.enrolled} of {offering.capacity}</strong></span></article>
      <article><Video /><span><small>Location</small><strong>{joinUrl ? "Google Meet" : "In person / pending"}</strong></span></article>
    </div>
    <Section title="About this class" marked><p className="class-description">{offering.description || "Class details will appear here when the coach adds them."}</p>{Boolean(offering.resourceLinks?.length) && <div className="class-resources">{offering.resourceLinks!.map((resource) => <a key={`${resource.label}-${resource.url}`} className="button-link" href={resource.url} target="_blank" rel="noreferrer">{resource.label}</a>)}</div>}</Section>
    <div className="class-content-grid">
      <Section title="Assignments" aside={coach ? <button onClick={() => setAssignmentOpen((value) => !value)}>{assignmentOpen ? "Close" : "Add assignment"}</button> : undefined}>
        {assignmentOpen && <form className="class-assignment-form" onSubmit={createAssignment}><label>Title<input required value={assignment.title} onChange={(event) => setAssignment({ ...assignment, title: event.target.value })}/></label><label>Due date<input type="datetime-local" value={assignment.dueAt} onChange={(event) => setAssignment({ ...assignment, dueAt: event.target.value })}/></label><label className="full">Instructions<textarea required value={assignment.details} onChange={(event) => setAssignment({ ...assignment, details: event.target.value })}/></label><button className="primary full" disabled={assignmentBusy}>{assignmentBusy ? "Sharing…" : "Share with class"}</button></form>}
        <div className="table-list">{assignmentGroups.map((item) => <article key={item.id}><CheckSquare/><div><strong>{item.title}</strong><small>{item.details}{item.dueAt ? ` · Due ${formatStudioDateTime(item.dueAt, data.settings.timezone)}` : ""}</small></div><Status tone={item.status === "completed" ? "good" : "neutral"}>{item.status}</Status></article>)}{!assignmentGroups.length && <EmptyState title="No class assignments" detail="Class work shared by the coach will stay connected to this class."/>}</div>
      </Section>
      <Section title="Class board" marked>
        <div className="class-message-list">{messages.map((item) => <article key={item.id}><header><strong>{item.authorName}</strong><Status tone={item.authorRole === "coach" ? "good" : "neutral"}>{item.authorRole}</Status></header><p>{item.body}</p><small>{formatStudioDateTime(item.createdAt, data.settings.timezone)}</small></article>)}{!messages.length && <EmptyState title="No class messages" detail="Updates and class questions will stay together here."/>}</div>
        <form className="lesson-message-form" onSubmit={postMessage}><label htmlFor="class-message"><MessageSquare/>Post to the class</label><textarea id="class-message" required maxLength={4000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Share an update or ask a class question…"/><button className="primary" disabled={messageBusy || !message.trim()}>{messageBusy ? "Posting…" : "Post message"}</button></form>
      </Section>
    </div>
    {coach && <Section title="Students"><div className="table-list">{participants.map((participant) => <article key={participant.id}><Users/><div><strong>{participant.displayName}</strong><small>{participant.email}</small></div><Status tone={participant.status === "confirmed" ? "good" : "neutral"}>{participant.status}</Status></article>)}{!participants.length && <EmptyState title="No students enrolled" detail="Confirmed class bookings will appear here."/>}</div></Section>}
  </div>;
}
