import {
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  FolderOpen,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import DOMPurify from "dompurify";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  EmptyState,
  ListControls,
  Section,
  Status,
  usePagedList,
} from "../../components/Primitives";
import {
  formatMoney,
  packageSummary,
  studentBalanceMinor,
} from "../../domain/finance";
import type {
  ActorProfileStatus,
  DiscountCode,
  IntegrationImport,
  Lesson,
  PackageDefinition,
  StudioSnapshot,
} from "../../domain/model";
import { useStudioStore } from "../../state/StudioStore";
import { studioCommand } from "../../data/bookingCommands";

const studentName = (data: StudioSnapshot, id: string) =>
  data.students.find((item) => item.id === id)?.fullName || "Student";
const sourceLabel = (source?: string) => ({studio:"Studio",public_booking:"Direct booking",google_calendar:"Google Calendar",gmail:"Gmail",lessonface:"Lessonface",wyzant:"Wyzant",lessons_com:"Lessons.com",acuity:"Acuity"} as Record<string,string>)[source||"studio"] || source;
export function TodayView({ data, isDemo }: { data: StudioSnapshot; isDemo: boolean }) {
  const store = useStudioStore(),
    queryClient = useQueryClient(),
    navigate = useNavigate(),
    [notice, setNotice] = useState(""),
    [reviewing, setReviewing] = useState<IntegrationImport>();
  const today = new Date().toDateString();
  const lessons = data.lessons
    .filter((i) => i.status === "scheduled" && new Date(i.startsAt).toDateString() === today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const noteFollowups = data.lessons.filter((lesson) => {
    const ended = new Date(lesson.endsAt).getTime();
    return ended <= Date.now() && !["cancelled", "late_cancelled"].includes(lesson.status) && !data.notes.some((note) => note.lessonId === lesson.id && note.status === "published");
  }).sort((a, b) => a.endsAt.localeCompare(b.endsAt));
  const notePage = usePagedList(noteFollowups);
  const reviewGroups = Object.values(
    data.integrationImports
      .filter((item) => item.status === "needs_review")
      .reduce<Record<string, IntegrationImport[]>>((groups, item) => {
        const key = `${item.detectedSource}:${importSummary(item)}`;
        (groups[key] ||= []).push(item);
        return groups;
      }, {}),
  );
  const importPage = usePagedList(reviewGroups);
  const complete = async (lesson: Lesson) => {
    try {
      if (isDemo) store.transact((draft) => {
        const item = draft.lessons.find((i) => i.id === lesson.id)!;
        item.status = "completed";
        item.version += 1;
        item.updatedAt = new Date().toISOString();
      });
      else {
        await studioCommand("lessons", { command: "complete", entityId: lesson.id, expectedVersion: lesson.version, reason: "Coach completed lesson" });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice("Lesson completed. Add the follow-up from the student record when you are ready.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Lesson could not be completed."); }
  };
  const reviewed = async () => {
    setReviewing(undefined);
    await queryClient.invalidateQueries({ queryKey: ["studio"] });
    setNotice("The provider signal was reviewed and the student record was updated.");
  };
  return (
    <>
    <Section title="Today’s teaching flow" marked>
      {notice && <p className="portal-notice">{notice}</p>}
      <div className="workflow-list">
        {lessons.map((lesson, index) => (
          <article key={lesson.id}>
            <span>{index + 1}</span>
            <div>
              <strong>
                {studentName(data, lesson.studentId)} · {lesson.topic}
              </strong>
              <small>
                {new Date(lesson.startsAt).toLocaleString()} ·{" "}
                {lesson.locationLabel} · {sourceLabel(lesson.sourceProvider)}
              </small>
            </div>
            <Status tone="good">scheduled</Status>
            <button onClick={() => void complete(lesson)}>Complete</button>
          </article>
        ))}
        {!lessons.length && (
          <EmptyState
            title="The rest of today is clear"
            detail="Only today’s scheduled lessons appear here. Use Home for the week ahead."
          />
        )}
      </div>
    </Section>
    <Section title="Notes due within 48 hours" marked>
      <div className="workflow-list">
        {notePage.visible.map((lesson) => { const due = new Date(new Date(lesson.endsAt).getTime() + 48 * 60 * 60 * 1000), remaining = due.getTime() - Date.now(); return <article key={`note-${lesson.id}`}><FileText /><div><strong>{studentName(data, lesson.studentId)} · {lesson.topic}</strong><small>{remaining > 0 ? `${Math.max(1, Math.ceil(remaining / 3_600_000))} hours remaining` : `Overdue since ${due.toLocaleString()}`}</small></div><Status tone={remaining <= 0 ? "danger" : remaining < 12 * 3_600_000 ? "warn" : "neutral"}>{remaining <= 0 ? "overdue" : "due"}</Status><button onClick={() => navigate(`/coach/students/${lesson.studentId}/notes`)}>Write note</button></article>; })}
        {!noteFollowups.length && <EmptyState title="Lesson notes are caught up" detail="A reminder appears here after each lesson and remains until a note is published." />}
      </div>
      {noteFollowups.length > 0 && <ListControls page={notePage.page} pageCount={notePage.pageCount} pageSize={notePage.pageSize} total={notePage.total} onPage={notePage.setPage} onPageSize={notePage.setPageSize} label="note follow-ups" />}
    </Section>
    {reviewGroups.length > 0 && <div id="verification"><Section title="Verify imported lessons"><p className="section-intro">These are provider signals waiting for one clear decision. Confirming links the lesson to the student profile; matching series can be handled together.</p><div className="table-list">{importPage.visible.map((group) => {const item=group[0];return <article key={item.id}><CalendarDays /><div><strong>{sourceLabel(item.detectedSource)}{group.length>1?` · ${group.length} matching lessons`:" lesson"}</strong><small>{importSummary(item)} · {item.studentId ? `suggested: ${studentName(data,item.studentId)} · ` : "student not matched · "}{Math.round(item.confidence*100)}% confidence{item.matchedBy ? ` by ${item.matchedBy}` : ""}</small></div><Status tone="warn">needs decision</Status><button onClick={() => setReviewing(item)}>Verify</button></article>;})}</div><ListControls page={importPage.page} pageCount={importPage.pageCount} pageSize={importPage.pageSize} total={importPage.total} onPage={importPage.setPage} onPageSize={importPage.setPageSize} label="import groups" /></Section></div>}
    {reviewing && <ImportReviewDialog item={reviewing} similarCount={reviewGroups.find((group)=>group.some((entry)=>entry.id===reviewing.id))?.length||1} data={data} onClose={() => setReviewing(undefined)} onReviewed={reviewed} />}
    </>
  );
}

function importSummary(item: IntegrationImport) {
  const payload = item.payload || {}, headers = (payload.headers || {}) as Record<string,string>;
  return String(payload.summary || headers.subject || payload.snippet || sourceLabel(item.detectedSource));
}

function importEmail(item: IntegrationImport, data: StudioSnapshot) {
  const payload = item.payload || {}, attendees = Array.isArray(payload.attendees) ? payload.attendees : [];
  const attendeeEmails = attendees.map((attendee)=>String((attendee as Record<string,unknown>).email||""));
  const textEmails = JSON.stringify(payload).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const matches = [...attendeeEmails, ...textEmails].filter(Boolean);
  const coachEmails = new Set([data.settings.contactEmail, ...(data.settings.coachEmails || [])].map((email)=>email.toLowerCase()));
  return matches.find((email)=>{
    const normalized=email.toLowerCase();
    return !coachEmails.has(normalized) && !normalized.endsWith("@google.com") && !normalized.includes("calendar-notification") && !normalized.includes("noreply");
  }) || "";
}

function ImportReviewDialog({ item, similarCount, data, onClose, onReviewed }: { item: IntegrationImport; similarCount:number; data: StudioSnapshot; onClose:()=>void; onReviewed:()=>Promise<void> }) {
  const candidate=(item.payload?.candidate||{}) as {startsAt?:string;endsAt?:string;locationLabel?:string}, [mode,setMode]=useState<"existing"|"create">(item.studentId?"existing":"create"), [studentId,setStudentId]=useState(item.studentId||""), [name,setName]=useState(""), [email,setEmail]=useState(importEmail(item,data)), [merge,setMerge]=useState(false), [note,setNote]=useState(""), [saving,setSaving]=useState(false), [error,setError]=useState("");
  const submit=async(event:FormEvent)=>{event.preventDefault();if(saving)return;setSaving(true);setError("");try{await studioCommand("integrations",{command:"review_import",entityId:item.id,expectedVersion:0,payload:{action:mode,applySimilar:similarCount>1,studentId:mode==="existing"?studentId:undefined,fullName:mode==="create"?name:undefined,email:mode==="create"?email:undefined,mergeStudentId:merge&&item.studentId&&item.studentId!==studentId?item.studentId:undefined,note},reason:"Coach reviewed provider lesson"});await onReviewed();}catch(reason){setError(reason instanceof Error?reason.message:"The lesson could not be verified.");}finally{setSaving(false);}};
  const ignore=async()=>{if(saving)return;setSaving(true);setError("");try{await studioCommand("integrations",{command:"review_import",entityId:item.id,expectedVersion:0,payload:{action:"ignore",applySimilar:similarCount>1,note},reason:"Coach ignored provider lesson"});await onReviewed();}catch(reason){setError(reason instanceof Error?reason.message:"The provider item could not be ignored.");}finally{setSaving(false);}};
  return <Dialog title="Verify imported lesson" description={`${sourceLabel(item.detectedSource)} · ${importSummary(item)}${similarCount>1?` · ${similarCount} matching occurrences`:""}`} onClose={onClose}><form className="workflow-form" onSubmit={submit}>{error&&<p className="inline-error" role="alert">{error}</p>}{candidate.startsAt&&<div className="import-evidence full"><strong>Lesson detected</strong><span>{new Date(candidate.startsAt).toLocaleString()} – {candidate.endsAt?new Date(candidate.endsAt).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}):"end time unavailable"}</span><small>{candidate.locationLabel||"Provider booking"}. Confirming creates or links this lesson in the selected student profile.</small></div>}<div className="settings-list full"><button type="button" role="switch" aria-checked={mode==="existing"} className={`setting-toggle toggle-button ${mode==="existing"?"on":""}`} onClick={()=>setMode("existing")}><span><strong>Link an existing student</strong><small>Use one current record and avoid a duplicate.</small></span><i aria-hidden="true"><b /></i></button><button type="button" role="switch" aria-checked={mode==="create"} className={`setting-toggle toggle-button ${mode==="create"?"on":""}`} onClick={()=>setMode("create")}><span><strong>Create an interested student</strong><small>Save a new lead from this provider signal.</small></span><i aria-hidden="true"><b /></i></button></div>{mode==="existing"?<><label className="full">Student<select required value={studentId} onChange={event=>{setStudentId(event.target.value);setMerge(false);}}><option value="">Choose a student</option>{[...data.students].sort((a,b)=>a.fullName.localeCompare(b.fullName)).map(student=><option key={student.id} value={student.id}>{student.fullName} · {student.email||student.guardianEmail||"no email"}</option>)}</select></label>{item.studentId&&studentId&&item.studentId!==studentId&&<label className="check-row full"><input type="checkbox" checked={merge} onChange={event=>setMerge(event.target.checked)}/><span><strong>Merge {studentName(data,item.studentId)} into this record</strong><small>Lessons, notes, materials, payments, relationships, and portal access move to the selected student.</small></span></label>}</>:<><label>Full name<input required autoFocus value={name} onChange={event=>setName(event.target.value)}/></label><label>Email<input type="email" value={email} onChange={event=>setEmail(event.target.value)}/></label></>}<label className="full">Verification note (optional)<input value={note} onChange={event=>setNote(event.target.value)} placeholder="What you checked or corrected"/></label><div className="form-actions full"><button type="button" disabled={saving} onClick={()=>void ignore()}>Ignore{similarCount>1?` ${similarCount} signals`:" signal"}</button><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving?"Saving…":mode==="create"?`Create & attach lesson${similarCount>1?`s (${similarCount})`:""}`:`Confirm student & lesson${similarCount>1?`s (${similarCount})`:""}`}</button></div></form></Dialog>;
}
export function LessonsView({ data, isDemo }: { data: StudioSnapshot; isDemo: boolean }) {
  const navigate = useNavigate(),
    store = useStudioStore(),
    queryClient = useQueryClient(),
    [selected, setSelected] = useState<Lesson>(),
    [start, setStart] = useState(""),
    [notice, setNotice] = useState("");
  const sortedLessons = [...data.lessons].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const lessonPage = usePagedList(sortedLessons);
  const update = async (status: "completed" | "cancelled") => {
    if (!selected) return;
    try {
      if (isDemo) store.transact((draft) => {
        const item = draft.lessons.find((i) => i.id === selected.id)!;
        item.status = status;
        item.version += 1;
        item.updatedAt = new Date().toISOString();
      });
      else {
        await studioCommand("lessons", { command: status === "completed" ? "complete" : "cancel", entityId: selected.id, expectedVersion: selected.version, reason: `Coach marked lesson ${status}` });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setSelected(undefined); setNotice(`Lesson marked ${status}.`);
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Lesson could not be updated."); }
  };
  const move = async () => {
    if (!selected || !start) return;
    const startsAt = new Date(start).toISOString(),
      duration =
        new Date(selected.endsAt).getTime() -
        new Date(selected.startsAt).getTime();
    const endsAt = new Date(new Date(startsAt).getTime() + duration).toISOString();
    try {
      if (isDemo) store.transact((draft) => {
        const item = draft.lessons.find((i) => i.id === selected.id)!;
        item.startsAt = startsAt; item.endsAt = endsAt; item.version += 1;
      });
      else {
        await studioCommand("lessons", { command: "reschedule", entityId: selected.id, expectedVersion: selected.version, payload: { startsAt, endsAt }, reason: "Coach rescheduled lesson" });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setSelected(undefined); setNotice("Lesson rescheduled.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Lesson could not be rescheduled."); }
  };
  return (
    <Section title="All lessons" marked>
      {notice && <p className="portal-notice">{notice}</p>}
      <ListControls page={lessonPage.page} pageCount={lessonPage.pageCount} pageSize={lessonPage.pageSize} total={lessonPage.total} onPage={lessonPage.setPage} onPageSize={lessonPage.setPageSize} label="lessons" />
      <div className="table-list">
        {lessonPage.visible
          .map((lesson) => (
            <article key={lesson.id}>
              <CalendarDays />
              <div>
                <strong>
                  {lesson.topic} · {studentName(data, lesson.studentId)}
                </strong>
                <small>
                  {new Date(lesson.startsAt).toLocaleString()} ·{" "}
                  {lesson.locationLabel} · {sourceLabel(lesson.sourceProvider)}
                </small>
              </div>
              <Status
                tone={
                  lesson.status === "completed"
                    ? "good"
                    : lesson.status === "scheduled"
                      ? "neutral"
                      : "warn"
                }
              >
                {lesson.status}
              </Status>
              <button
                onClick={() => {
                  setSelected(lesson);
                  setStart(
                    new Date(lesson.startsAt).toISOString().slice(0, 16),
                  );
                }}
              >
                Open
              </button>
            </article>
          ))}
      </div>
      {selected && (
        <Dialog
          title={selected.topic}
          description={studentName(data, selected.studentId)}
          onClose={() => setSelected(undefined)}
        >
          <div className="workflow-content">
            <button
              className="text-button"
              onClick={() =>
                navigate(`/coach/students/${selected.studentId}/lessons`)
              }
            >
              Open full student lesson history
            </button>
            {selected.status === "scheduled" && (
              <label>
                New start
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
            )}
            <div className="form-actions">
              {selected.status === "scheduled" && (
                <>
                  <button onClick={() => void update("cancelled")}>
                    Cancel lesson
                  </button>
                  <button onClick={() => void move()}>Reschedule</button>
                  <button
                    className="primary"
                    onClick={() => void update("completed")}
                  >
                    Mark complete
                  </button>
                </>
              )}
            </div>
          </div>
        </Dialog>
      )}
    </Section>
  );
}
export function NotesView({ data, isDemo = false }: { data: StudioSnapshot; isDemo?: boolean }) {
  const navigate = useNavigate(), store = useStudioStore(), queryClient = useQueryClient();
  const [query, setQuery] = useState(""), [status, setStatus] = useState("all"), [notice, setNotice] = useState(""), [deleting, setDeleting] = useState(""), [selected,setSelected]=useState<StudioSnapshot["notes"][number]>();
  const filtered = [...data.notes].filter((note) => (status === "all" || note.status === status) && [note.title, note.body, studentName(data, note.studentId), ...(note.tags || [])].join(" ").toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const notePage = usePagedList(filtered);
  const remove = async (note: StudioSnapshot["notes"][number]) => {
    if (deleting || !window.confirm(`Delete “${note.title}”? This cannot be undone.`)) return;
    setDeleting(note.id);
    try { if (isDemo) store.transact((draft) => { draft.notes = draft.notes.filter((item) => item.id !== note.id); }); else { await studioCommand("notes", { command: "delete", entityId: note.id, expectedVersion: note.version, reason: "Coach deleted note" }); await queryClient.invalidateQueries({ queryKey: ["studio"] }); } setNotice("Note deleted."); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : "Note could not be deleted."); }
    finally { setDeleting(""); }
  };
  return (
    <Section title="Notes across the studio" marked>
      {notice && <p className="portal-notice">{notice}</p>}
      <div className="library-toolbar"><label><Search /><input aria-label="Search notes" placeholder="Search notes or students…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Note status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="draft">Drafts</option><option value="published">Published</option></select></div>
      <ListControls page={notePage.page} pageCount={notePage.pageCount} pageSize={notePage.pageSize} total={notePage.total} onPage={notePage.setPage} onPageSize={notePage.setPageSize} label="notes" />
      <div className="lesson-note-index">
        {notePage.visible
          .map((note) => (
            <button type="button" key={note.id} onClick={()=>setSelected(note)}><CalendarDays/><span><strong>{note.lessonId?new Date(data.lessons.find(item=>item.id===note.lessonId)?.startsAt||note.updatedAt).toLocaleDateString():"General note"}</strong><small>{studentName(data,note.studentId)} · {data.lessons.find(item=>item.id===note.lessonId)?.topic||note.title} · {note.title}</small></span><Status tone={note.status === "published" ? "good" : "neutral"}>{note.status}</Status></button>
          ))}
        {!filtered.length && (
          <EmptyState
            title="No notes yet"
            detail="Open a student record to save a private draft or publish follow-up."
          />
        )}
      </div>
      {selected&&<Dialog title={selected.title} description={`${studentName(data,selected.studentId)} · ${selected.lessonId?new Date(data.lessons.find(item=>item.id===selected.lessonId)?.startsAt||selected.updatedAt).toLocaleString():"General note"}`} onClose={()=>setSelected(undefined)}>{selected.bodyHtml?<div className="rich-note-body" dangerouslySetInnerHTML={{__html:DOMPurify.sanitize(selected.bodyHtml)}}/>:<p>{selected.body}</p>}<div className="form-actions"><button type="button" onClick={()=>{setSelected(undefined);navigate(`/coach/students/${selected.studentId}/notes`);}}>Open student notes</button><button type="button" className="danger-button" disabled={deleting===selected.id} onClick={()=>{void remove(selected);setSelected(undefined);}}><Trash2/>Delete note</button></div></Dialog>}
    </Section>
  );
}
export function MaterialsView({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const navigate = useNavigate(),
    store = useStudioStore(),
    queryClient = useQueryClient(),
    [notice, setNotice] = useState("");
  const archive = async (id: string) => {
    const current = data.materials.find((item) => item.id === id)!;
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.materials.find((i) => i.id === id)!;
          item.status = item.status === "active" ? "archived" : "active";
          item.version += 1;
        });
      else {
        await studioCommand("materials", {
          command: "update_status",
          entityId: id,
          expectedVersion: current.version,
          payload: {
            status: current.status === "active" ? "archived" : "active",
          },
          reason: "Coach updated material status",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice("Material status updated.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Material could not be updated.",
      );
    }
  };
  const review = async (
    id: string,
    status: "approved" | "changes_requested",
  ) => {
    const current = data.materials.find((item) => item.id === id)!;
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.materials.find((row) => row.id === id)!;
          item.approvalStatus = status;
          item.publicEmbed = status === "approved";
          item.version += 1;
        });
      else {
        await studioCommand("materials", {
          command: "approve",
          entityId: id,
          expectedVersion: current.version,
          payload: { status, publicEmbed: status === "approved" },
          reason: `Coach ${status} actor material`,
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice(`Material ${status.replaceAll("_", " ")}.`);
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Material review failed.",
      );
    }
  };
  return (
    <Section title="Material library" marked>
      {notice && <p className="portal-notice">{notice}</p>}
      <div className="table-list">
        {data.materials.map((item) => (
          <article key={item.id}>
            <FolderOpen />
            <div>
              <strong>{item.title}</strong>
              <small>
                {studentName(data, item.studentId)} · {item.category} ·{" "}
                {item.role.replaceAll("_", " ")}
              </small>
            </div>
            <Status
              tone={
                item.approvalStatus === "approved"
                  ? "good"
                  : item.approvalStatus === "pending_review"
                    ? "warn"
                    : "neutral"
              }
            >
              {item.status}
            </Status>
            <button
              onClick={() => navigate(`/coach/students/${item.studentId}/${item.role==="actor_material"?"actor-page":"work"}`)}
            >
              Student
            </button>
            {item.approvalStatus === "pending_review" && (
              <>
                <button onClick={() => void review(item.id, "approved")}>
                  Approve for actor page
                </button>
                <button
                  onClick={() => void review(item.id, "changes_requested")}
                >
                  Request changes
                </button>
              </>
            )}
            <button onClick={() => void archive(item.id)}>
              {item.status === "active" ? "Archive" : "Restore"}
            </button>
          </article>
        ))}
      </div>
    </Section>
  );
}
export function FinanceView({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const navigate = useNavigate(),
    store = useStudioStore(),
    queryClient = useQueryClient(),
    [dialog, setDialog] = useState<PackageDefinition | "new">(),
    [discountDialog, setDiscountDialog] = useState<DiscountCode | "new">(),
    [notice, setNotice] = useState("");
  const saveDiscount = async(value:DiscountCode)=>{try{if(isDemo)store.transact((draft)=>{const current=draft.discountCodes.find((item)=>item.id===value.id);if(current)Object.assign(current,value,{version:current.version+1,updatedAt:new Date().toISOString()});else draft.discountCodes.push(value);});else{await studioCommand("discounts",{command:data.discountCodes.some((item)=>item.id===value.id)?"update":"create",entityId:data.discountCodes.some((item)=>item.id===value.id)?value.id:undefined,expectedVersion:data.discountCodes.find((item)=>item.id===value.id)?.version??0,payload:value as unknown as Record<string,unknown>,reason:"Coach configured a booking discount"});await queryClient.invalidateQueries({queryKey:["studio"]});}setDiscountDialog(undefined);setNotice("Discount code saved and available to the booking checkout.");}catch(reason){setNotice(reason instanceof Error?reason.message:"Discount code could not be saved.");}};
  const save = async (value: PackageDefinition) => {
    try {
      if (isDemo)
        store.transact((draft) => {
          const existing = draft.packageDefinitions.find(
            (item) => item.id === value.id,
          );
          if (existing)
            Object.assign(existing, value, {
              version: existing.version + 1,
              updatedAt: new Date().toISOString(),
            });
          else draft.packageDefinitions.push(value);
        });
      else {
        await studioCommand("packages", {
          command: data.packageDefinitions.some((item) => item.id === value.id)
            ? "update"
            : "create",
          entityId: data.packageDefinitions.some((item) => item.id === value.id)
            ? value.id
            : undefined,
          expectedVersion:
            data.packageDefinitions.find((item) => item.id === value.id)
              ?.version ?? 0,
          payload: value as unknown as Record<string, unknown>,
          reason: "Coach configured lesson package",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setDialog(undefined);
      setNotice("Package catalog saved.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Package could not be saved.",
      );
    }
  };
  return (
    <div>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      <div className="two-section-grid">
        <Section
          title="Package catalog"
          marked
          aside={<button onClick={() => setDialog("new")}>Add package</button>}
        >
          <div className="table-list">
            {data.packageDefinitions.map((definition) => (
              <article key={definition.id}>
                <CircleDollarSign />
                <div>
                  <strong>{definition.name}</strong>
                  <small>
                    {definition.sessionCount} ×{" "}
                    {definition.sessionDurationMinutes} minutes ·{" "}
                    {formatMoney(definition.priceMinor, definition.currency)}
                  </small>
                </div>
                <Status
                  tone={
                    definition.active
                      ? definition.visibility === "public"
                        ? "good"
                        : "warn"
                      : "neutral"
                  }
                >
                  {definition.active ? definition.visibility : "archived"}
                </Status>
                <button onClick={() => setDialog(definition)}>Edit</button>
              </article>
            ))}
            {!data.packageDefinitions.length && (
              <EmptyState
                title="No package products"
                detail="Create reusable 4-, 6-, 8-, 10-, or custom-session packages here."
              />
            )}
          </div>
        </Section>
        <Section title="Student packages">
          <div className="table-list">
            {data.packages.map((pkg) => (
              <article key={pkg.id}>
                <CircleDollarSign />
                <div>
                  <strong>
                    {studentName(data, pkg.studentId)} · {pkg.name}
                  </strong>
                  <small>{formatMoney(pkg.priceMinor, pkg.currency)}</small>
                </div>
                <Status
                  tone={
                    packageSummary(pkg, data.creditEntries).remainingCredits <=
                    1
                      ? "warn"
                      : "good"
                  }
                >
                  {packageSummary(pkg, data.creditEntries).remainingCredits}{" "}
                  left
                </Status>
                <button
                  onClick={() =>
                    navigate(`/coach/students/${pkg.studentId}/payments`)
                  }
                >
                  Open
                </button>
              </article>
            ))}
            {!data.packages.length && (
              <EmptyState
                title="No student packages"
                detail="Purchased or coach-assigned package balances will appear here."
              />
            )}
          </div>
        </Section>
        <Section title="Balances">
          <div className="table-list">
            {data.students.map((student) => (
              <article key={student.id}>
                <CheckCircle2 />
                <div>
                  <strong>{student.fullName}</strong>
                  <small>Payments, refunds, and adjustments</small>
                </div>
                <strong>
                  {formatMoney(studentBalanceMinor(student.id, data.payments))}
                </strong>
                <button
                  onClick={() => navigate(`/coach/students/${student.id}/payments`)}
                >
                  Open
                </button>
              </article>
            ))}
            {!data.students.length && (
              <EmptyState
                title="No balances yet"
                detail="Add a student to begin tracking charges, payments, refunds, and adjustments."
              />
            )}
          </div>
        </Section>
        <Section title="Coupons & discounts" marked aside={<button onClick={()=>setDiscountDialog("new")}>Create code</button>}>
          <div className="table-list">{data.discountCodes.map((code)=><article key={code.id}><CircleDollarSign/><div><strong>{code.code}</strong><small>{code.description||"Booking discount"} · {code.discountType==="percent"?`${code.amount}%`:formatMoney(code.amount,code.currency)} · {code.redemptionCount} used</small></div><Status tone={code.active?"good":"neutral"}>{code.active?"active":"inactive"}</Status><button onClick={()=>setDiscountDialog(code)}>Edit</button></article>)}{!data.discountCodes.length&&<EmptyState title="No discount codes" detail="Create optional codes that can apply to every service or selected services."/>}</div>
        </Section>
      </div>
      {dialog && (
        <PackageDefinitionDialog
          value={dialog === "new" ? undefined : dialog}
          data={data}
          onClose={() => setDialog(undefined)}
          onSave={(value) => void save(value)}
        />
      )}
      {discountDialog && <DiscountDialog value={discountDialog==="new"?undefined:discountDialog} data={data} onClose={()=>setDiscountDialog(undefined)} onSave={(value)=>void saveDiscount(value)}/>}
    </div>
  );
}

function DiscountDialog({value,data,onClose,onSave}:{value?:DiscountCode;data:StudioSnapshot;onClose:()=>void;onSave:(value:DiscountCode)=>void}){
  const [form,setForm]=useState<DiscountCode>(()=>value?structuredClone(value):{id:`discount-${crypto.randomUUID()}`,studioId:data.studioId,code:"",description:"",discountType:"percent",amount:10,currency:"USD",serviceIds:[],active:true,redemptionCount:0,version:1,updatedAt:new Date().toISOString()});
  const toggle=(id:string,checked:boolean)=>setForm({...form,serviceIds:checked?[...new Set([...form.serviceIds,id])]:form.serviceIds.filter((item)=>item!==id)});
  return <Dialog title={value?`Edit ${value.code}`:"Create discount code"} description="Codes are validated on the server and snapshotted on each booking." onClose={onClose}><form className="workflow-form" onSubmit={event=>{event.preventDefault();onSave({...form,code:form.code.toUpperCase()});}}><label>Code<input required minLength={3} value={form.code} onChange={event=>setForm({...form,code:event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g,"")})} placeholder="WELCOME10"/></label><label>Discount<select value={form.discountType} onChange={event=>setForm({...form,discountType:event.target.value as DiscountCode["discountType"]})}><option value="percent">Percentage</option><option value="fixed">Fixed USD amount</option></select></label><label>Amount<input required type="number" min="1" max={form.discountType==="percent"?100:100000} value={form.discountType==="fixed"?form.amount/100:form.amount} onChange={event=>setForm({...form,amount:form.discountType==="fixed"?Math.round(Number(event.target.value)*100):Number(event.target.value)})}/></label><label>Maximum uses<input type="number" min="1" value={form.maxRedemptions||""} onChange={event=>setForm({...form,maxRedemptions:event.target.value?Number(event.target.value):undefined})}/></label><label className="full">Description<input value={form.description} onChange={event=>setForm({...form,description:event.target.value})}/></label><fieldset className="full option-fieldset"><legend>Eligible services</legend><small>Leave every service unchecked to apply the code studio-wide.</small>{data.bookingServices.map((service)=><label className="check-row" key={service.id}><input type="checkbox" checked={form.serviceIds.includes(service.id)} onChange={event=>toggle(service.id,event.target.checked)}/>{service.name}</label>)}</fieldset><label className="check-row full"><input type="checkbox" checked={form.active} onChange={event=>setForm({...form,active:event.target.checked})}/>Active</label><div className="form-actions full"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Save discount</button></div></form></Dialog>;
}

function PackageDefinitionDialog({
  value,
  data,
  onClose,
  onSave,
}: {
  value?: PackageDefinition;
  data: StudioSnapshot;
  onClose: () => void;
  onSave: (value: PackageDefinition) => void;
}) {
  const [form, setForm] = useState<PackageDefinition>(() =>
      value
        ? structuredClone(value)
        : {
            id: `package-definition-${crypto.randomUUID()}`,
            studioId: data.studioId,
            name: "",
            description: "",
            sessionCount: 4,
            sessionDurationMinutes: 60,
            priceMinor: 0,
            discountMinor: 0,
            currency: "USD",
            expirationDays: 180,
            eligibleServiceIds: [],
            meetingProviders: ["google_meet", "in_person"],
            recurringEligible: true,
            visibility: "private",
            directPurchase: false,
            active: true,
            version: 1,
            updatedAt: new Date().toISOString(),
          },
    ),
    toggle = (items: string[], item: string, checked: boolean) =>
      checked
        ? [...new Set([...items, item])]
        : items.filter((current) => current !== item);
  return (
    <Dialog
      title={value ? "Edit package" : "Add package"}
      description="Package pricing is independent from single-session pricing. Stripe prices are created automatically for direct-purchase packages."
      onClose={onClose}
    >
      <form
        className="workflow-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(form);
        }}
      >
        <label>
          Name
          <input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label>
          Sessions
          <input
            required
            type="number"
            min="1"
            value={form.sessionCount}
            onChange={(event) =>
              setForm({ ...form, sessionCount: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Session duration
          <input
            required
            type="number"
            min="15"
            step="15"
            value={form.sessionDurationMinutes}
            onChange={(event) =>
              setForm({
                ...form,
                sessionDurationMinutes: Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Package price (USD)
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={form.priceMinor / 100}
            onChange={(event) =>
              setForm({
                ...form,
                priceMinor: Math.round(Number(event.target.value) * 100),
              })
            }
          />
        </label>
        <label>
          Expires after days
          <input
            type="number"
            min="1"
            value={form.expirationDays ?? ""}
            onChange={(event) =>
              setForm({
                ...form,
                expirationDays: event.target.value
                  ? Number(event.target.value)
                  : undefined,
              })
            }
          />
        </label>
        <label>
          Visibility
          <select
            value={form.visibility}
            onChange={(event) =>
              setForm({
                ...form,
                visibility: event.target
                  .value as PackageDefinition["visibility"],
              })
            }
          >
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </label>
        <label className="full">
          Description
          <textarea
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
          />
        </label>
        <fieldset className="full option-fieldset">
          <legend>Eligible services</legend>
          {data.bookingServices.map((service) => (
            <label className="check-row" key={service.id}>
              <input
                type="checkbox"
                checked={form.eligibleServiceIds.includes(service.id)}
                onChange={(event) =>
                  setForm({
                    ...form,
                    eligibleServiceIds: toggle(
                      form.eligibleServiceIds,
                      service.id,
                      event.target.checked,
                    ),
                  })
                }
              />
              {service.name}
            </label>
          ))}
        </fieldset>
        <fieldset className="full option-fieldset">
          <legend>Meeting formats</legend>
          {(["google_meet", "in_person"] as const).map((provider) => (
            <label className="check-row" key={provider}>
              <input
                type="checkbox"
                checked={form.meetingProviders.includes(provider)}
                onChange={(event) =>
                  setForm({
                    ...form,
                    meetingProviders: toggle(
                      form.meetingProviders,
                      provider,
                      event.target.checked,
                    ) as PackageDefinition["meetingProviders"],
                  })
                }
              />
              {provider.replaceAll("_", " ")}
            </label>
          ))}
        </fieldset>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.recurringEligible}
            onChange={(event) =>
              setForm({ ...form, recurringEligible: event.target.checked })
            }
          />
          Allow recurring lessons
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.directPurchase}
            onChange={(event) =>
              setForm({ ...form, directPurchase: event.target.checked })
            }
          />
          Student can buy directly
        </label>
        <label className="check-row full">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) =>
              setForm({ ...form, active: event.target.checked })
            }
          />
          Active package
        </label>
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Save package</button>
        </div>
      </form>
    </Dialog>
  );
}
export function ActorPagesView({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const store = useStudioStore(),
    navigate = useNavigate(),
    queryClient = useQueryClient(),
    [notice, setNotice] = useState("");
  const change = async (id: string, status: ActorProfileStatus) => {
    const profile = data.actorProfiles.find((item) => item.id === id)!;
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.actorProfiles.find((i) => i.id === id)!;
          item.status = status;
          item.version += 1;
          item.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("actor-pages", {
          command: "review",
          entityId: id,
          expectedVersion: profile.version,
          payload: { status },
          reason: "Coach reviewed actor page",
        });
        await queryClient.invalidateQueries({ queryKey: ["studio"] });
      }
      setNotice(`Actor page marked ${status.replaceAll("_", " ")}.`);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Actor page could not be updated.",
      );
    }
  };
  return (
    <Section title="Publishing workflow" marked>
      {notice && <p className="portal-notice">{notice}</p>}
      <div className="table-list">
        {data.actorProfiles.map((profile) => (
          <article key={profile.id}>
            <UserRound />
            <div>
              <strong>{profile.displayName}</strong>
              <small>
                /actors/{profile.slug} · {studentName(data, profile.studentId)}
              </small>
            </div>
            <Status tone={profile.status === "published" ? "good" : "warn"}>
              {profile.status.replaceAll("_", " ")}
            </Status>
            <button
              onClick={() =>
                navigate(`/coach/students/${profile.studentId}/actor-page`)
              }
            >
              Open
            </button>
            {profile.status === "review_requested" && (
              <button onClick={() => void change(profile.id, "approved")}>
                Approve
              </button>
            )}
            {profile.status !== "published" && (
              <button onClick={() => void change(profile.id, "published")}>
                Publish
              </button>
            )}
            {profile.status === "published" && (
              <>
                <a className="button-link" href={`/actors/${profile.slug}`} target="_blank" rel="noreferrer">
                  View live page
                </a>
                <button onClick={() => void change(profile.id, "changes_requested")}>
                  Unpublish
                </button>
              </>
            )}
          </article>
        ))}
        {!data.actorProfiles.length && (
          <EmptyState
            title="No actor pages"
            detail="Create a draft from an eligible student record."
          />
        )}
      </div>
    </Section>
  );
}
