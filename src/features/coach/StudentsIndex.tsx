import { Plus, Search, Upload, Users } from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, EmptyState, Section, Status } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import type { Student, StudentStatus, StudioSnapshot } from "../../domain/model";
import { useStudioStore } from "../../state/StudioStore";

const uid = () => `student-${crypto.randomUUID()}`;

type ImportedStudent = {
  fullName: string;
  email?: string;
  phone?: string;
  focusArea?: string;
  leadSource?: string;
  guardianName?: string;
  guardianEmail?: string;
};

export function StudentsIndex({ data, isDemo }: { data: StudioSnapshot; isDemo: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | StudentStatus>("all");
  const [adding, setAdding] = useState(new URLSearchParams(location.search).has("new"));
  const [notice, setNotice] = useState("");
  const [importRows, setImportRows] = useState<ImportedStudent[]>([]);
  const [importing, setImporting] = useState(false);
  const [merging, setMerging] = useState(false);

  const students = useMemo(
    () =>
      data.students.filter(
        (student) =>
          (status === "all" || student.status === status) &&
          [student.fullName, student.email, student.guardianEmail, student.focusArea, student.leadSource].some(
            (value) => String(value || "").toLowerCase().includes(query.toLowerCase()),
          ),
      ),
    [data.students, query, status],
  );
  const existingKeys = useMemo(
    () =>
      new Set(
        data.students.flatMap((student) => [normalize(student.email), normalize(student.fullName)]).filter(Boolean),
      ),
    [data.students],
  );
  const duplicates = importRows.filter(
    (row) => existingKeys.has(normalize(row.email)) || existingKeys.has(normalize(row.fullName)),
  );
  const newRows = importRows.filter(
    (row) => !existingKeys.has(normalize(row.email)) && !existingKeys.has(normalize(row.fullName)),
  );
  const counts = (value: StudentStatus) => data.students.filter((item) => item.status === value).length;

  const save = async (student: Student) => {
    if (isDemo) store.transact((draft) => draft.students.unshift(student));
    else {
      await studioCommand("students", {
        command: "create",
        expectedVersion: 0,
        payload: {
          fullName: student.fullName,
          email: student.email,
          phone: student.phone,
          focusArea: student.focusArea,
          leadSource: student.leadSource,
          isMinor: student.isMinor,
          guardianName: student.guardianName,
          guardianEmail: student.guardianEmail,
        },
        reason: "Coach added student",
      });
      await queryClient.invalidateQueries({ queryKey: ["studio"] });
    }
    setAdding(false);
    setNotice(`${student.fullName} was added. Open their record to add lessons, work, or portal access.`);
  };
  const loadCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const rows = parseStudentCsv(await file.text());
      if (!rows.length) throw new Error("No rows with a student name were found.");
      setImportRows(rows);
      setImporting(true);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That CSV could not be read. Check the headings and try again.");
    }
  };
  const confirmImport = async () => {
    const updatedAt = new Date().toISOString();
    if (isDemo) store.transact((draft) => {
      draft.students.unshift(
        ...newRows.map<Student>((row) => ({
          id: uid(),
          studioId: "studio-stage-story",
          fullName: row.fullName,
          email: row.email,
          phone: row.phone,
          guardianName: row.guardianName,
          guardianEmail: row.guardianEmail,
          focusArea: row.focusArea || "",
          leadSource: row.leadSource || "CSV import",
          status: "lead",
          isMinor: Boolean(row.guardianEmail || row.guardianName),
          portalEnabled: false,
          actorPageEligible: false,
          version: 1,
          updatedAt,
        })),
      );
    });
    else {
      for (const row of newRows) {
        await studioCommand("students", {
          command: "create",
          expectedVersion: 0,
          payload: {
            fullName: row.fullName,
            email: row.email,
            phone: row.phone,
            focusArea: row.focusArea,
            leadSource: row.leadSource || "CSV import",
            isMinor: Boolean(row.guardianEmail || row.guardianName),
            guardianName: row.guardianName,
            guardianEmail: row.guardianEmail,
          },
          reason: "Coach imported student roster",
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["studio"] });
    }
    setImporting(false);
    setImportRows([]);
    setNotice(
      `${newRows.length} ${newRows.length === 1 ? "student was" : "students were"} imported as interested students${duplicates.length ? `; ${duplicates.length} possible duplicate${duplicates.length === 1 ? " was" : "s were"} skipped` : ""}.`,
    );
  };

  return (
    <>
      <Section
        title="Studio roster"
        marked
        aside={<button className="primary-button" onClick={() => setAdding(true)}><Plus />Add student</button>}
      >
        {notice && <p className="portal-notice" role="status">{notice}</p>}
        <div className="roster-summary">
          <button className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}><strong>{data.students.length}</strong><span>Everyone</span></button>
          <button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}><strong>{counts("active")}</strong><span>Active</span></button>
          <button className={status === "lead" ? "active" : ""} onClick={() => setStatus("lead")}><strong>{counts("lead")}</strong><span>Interested</span></button>
          <button className={status === "paused" ? "active" : ""} onClick={() => setStatus("paused")}><strong>{counts("paused")}</strong><span>Paused</span></button>
          <button className={status === "alumni" ? "active" : ""} onClick={() => setStatus("alumni")}><strong>{counts("alumni")}</strong><span>Alumni</span></button>
        </div>
        <label className="roster-search">
          <Search />
          <input aria-label="Search students" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, focus, or source…" />
        </label>
        <div className="student-roster">
          {students.map((student) => (
            <button key={student.id} className="student-roster-row" onClick={() => navigate(`/students/${student.id}`)}>
              <span className="avatar">{student.fullName.split(" ").map((part) => part[0]).join("")}</span>
              <div><strong>{student.fullName}</strong><small>{student.focusArea || "Focus not set"} · {student.portalEnabled ? "Workspace ready" : "No portal access"}</small></div>
              <span className="roster-contact">{student.email || student.guardianEmail || "No email"}</span>
              <Status tone={student.status === "active" ? "good" : student.status === "lead" ? "warn" : "neutral"}>{student.status}</Status>
              <span className="open-label">Open</span>
            </button>
          ))}
          {!students.length && <EmptyState title="No students match" detail="Clear the search or choose another status." />}
        </div>
      </Section>
      <section className="quiet-tool">
        <Upload />
        <div><strong>Bringing in an existing roster?</strong><small>CSV import includes a duplicate review before anything is added.</small></div>
        <input ref={fileInput} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={loadCsv} />
        <button onClick={() => fileInput.current?.click()}>Import CSV</button>
        {!isDemo && <button onClick={() => setMerging(true)}>Merge duplicates</button>}
      </section>
      {adding && <StudentForm onClose={() => setAdding(false)} onSave={save} />}
      {importing && (
        <Dialog title="Review CSV import" description="New records are added as interested students. Existing matches are skipped, so nothing is overwritten." onClose={() => setImporting(false)}>
          <div className="workflow-content import-review">
            <div className="import-summary">
              <Status tone="good">{newRows.length} ready</Status>
              <Status tone={duplicates.length ? "warn" : "neutral"}>{duplicates.length} possible duplicates</Status>
            </div>
            <div className="import-preview" aria-label="CSV import preview">
              {importRows.slice(0, 8).map((row, index) => {
                const duplicate = duplicates.includes(row);
                return <article key={`${row.fullName}-${index}`}><div><strong>{row.fullName}</strong><small>{row.email || row.guardianEmail || "No email"}</small></div><Status tone={duplicate ? "warn" : "good"}>{duplicate ? "Skip match" : "Add"}</Status></article>;
              })}
              {importRows.length > 8 && <small>And {importRows.length - 8} more rows…</small>}
            </div>
            <div className="form-actions">
              <button onClick={() => setImporting(false)}>Cancel</button>
              <button className="primary" disabled={!newRows.length} onClick={() => void confirmImport()}>Import {newRows.length}</button>
            </div>
          </div>
        </Dialog>
      )}
      {merging && <MergeStudentsDialog data={data} onClose={() => setMerging(false)} onMerged={async (name) => {setMerging(false);await queryClient.invalidateQueries({queryKey:["studio"]});setNotice(`${name} is now one complete student record.`);}} />}
    </>
  );
}

function MergeStudentsDialog({data,onClose,onMerged}:{data:StudioSnapshot;onClose:()=>void;onMerged:(name:string)=>Promise<void>}) {
  const [keepId,setKeepId]=useState(""), [removeId,setRemoveId]=useState(""), [saving,setSaving]=useState(false), [error,setError]=useState("");
  const keep=data.students.find(student=>student.id===keepId), remove=data.students.find(student=>student.id===removeId);
  const submit=async(event:FormEvent)=>{event.preventDefault();if(!keep||!remove||saving)return;setSaving(true);setError("");try{await studioCommand("students",{command:"merge",entityId:keep.id,expectedVersion:keep.version,payload:{removeStudentId:remove.id},reason:`Coach merged duplicate student ${remove.fullName} into ${keep.fullName}`});await onMerged(keep.fullName);}catch(reason){setError(reason instanceof Error?reason.message:"The student records could not be merged.");}finally{setSaving(false);}};
  return <Dialog title="Merge duplicate students" description="Choose the record to keep. Lessons, notes, materials, payments, guardian access, and provider matches move into it." onClose={onClose}><form className="workflow-form" onSubmit={submit}>{error&&<p className="inline-error" role="alert">{error}</p>}<label className="full">Record to keep<select required value={keepId} onChange={event=>setKeepId(event.target.value)}><option value="">Choose the complete record</option>{data.students.map(student=><option key={student.id} value={student.id}>{student.fullName} · {student.email||student.guardianEmail||"no email"}</option>)}</select></label><label className="full">Duplicate to merge<select required value={removeId} onChange={event=>setRemoveId(event.target.value)}><option value="">Choose the duplicate</option>{data.students.filter(student=>student.id!==keepId).map(student=><option key={student.id} value={student.id}>{student.fullName} · {student.email||student.guardianEmail||"no email"}</option>)}</select></label>{keep&&remove&&<p className="portal-notice"><Users />{remove.fullName} will be removed after all linked history is transferred to {keep.fullName}. This action is recorded in the audit log.</p>}<div className="form-actions full"><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="primary" disabled={saving||!keep||!remove}>{saving?"Merging…":"Merge records"}</button></div></form></Dialog>;
}

function normalize(value?: string) {
  return value?.trim().toLowerCase() || "";
}

function parseStudentCsv(text: string): ImportedStudent[] {
  const table: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) table.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) table.push(row);
  if (quoted) throw new Error("The CSV has an unfinished quoted field.");
  const [rawHeaders = [], ...records] = table;
  const headers = rawHeaders.map((header) => header.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const value = (record: string[], ...keys: string[]) => {
    const index = headers.findIndex((header) => keys.includes(header));
    return index >= 0 ? record[index]?.trim() || undefined : undefined;
  };
  if (!headers.some((header) => ["name", "full_name", "student"].includes(header))) throw new Error('Add a "name" or "full_name" column before importing.');
  return records.map((record) => ({
    fullName: value(record, "name", "full_name", "student") || "",
    email: value(record, "email", "student_email"),
    phone: value(record, "phone", "telephone"),
    focusArea: value(record, "focus", "focus_area", "training_focus"),
    leadSource: value(record, "source", "lead_source"),
    guardianName: value(record, "guardian", "guardian_name"),
    guardianEmail: value(record, "guardian_email", "parent_email"),
  })).filter((record) => record.fullName);
}

function StudentForm({ onClose, onSave }: { onClose: () => void; onSave: (student: Student) => Promise<void> }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [focus, setFocus] = useState("");
  const [source, setSource] = useState("");
  const [minor, setMinor] = useState(false);
  const [guardianName, setGuardianName] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      await onSave({
        id: uid(), studioId: "demo-studio", fullName: name, email: email || undefined, phone: phone || undefined,
        guardianName: minor ? guardianName : undefined, guardianEmail: minor ? guardianEmail : undefined,
        focusArea: focus, leadSource: source, status: "lead", isMinor: minor, portalEnabled: false,
        actorPageEligible: false, version: 1, updatedAt: new Date().toISOString(),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Student could not be added.");
    } finally { setSaving(false); }
  };
  return (
    <Dialog title="Add student" description="Start with the essentials. Everything else lives in the student record." onClose={onClose}>
      <form className="workflow-form" onSubmit={submit}>
        {error && <p className="portal-notice" role="alert">{error}</p>}
        <label>Full name<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Student email<input required={!minor} type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
        <label>Focus area<input value={focus} onChange={(event) => setFocus(event.target.value)} /></label>
        <label>How they found you<input value={source} onChange={(event) => setSource(event.target.value)} /></label>
        <label className="check-row"><input type="checkbox" checked={minor} onChange={(event) => setMinor(event.target.checked)} /><span><strong>Student is under 18</strong><small>Add a guardian for communication and access.</small></span></label>
        {minor && <><label>Guardian name<input required value={guardianName} onChange={(event) => setGuardianName(event.target.value)} /></label><label>Guardian email<input required type="email" value={guardianEmail} onChange={(event) => setGuardianEmail(event.target.value)} /></label></>}
        <div className="form-actions full"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}><Users />{saving ? "Adding…" : "Add student"}</button></div>
      </form>
    </Dialog>
  );
}
