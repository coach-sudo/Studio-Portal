import {
  useUrlValue,
  useUrlNumber,
  useUrlChoice,
  useWorkspaceNavigation,
} from "../../hooks/useWorkspaceLocation";
import { Plus, Search, Upload, Users } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  Drawer,
  EmptyState,
  ListControls,
  Section,
  Status,
} from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { coachPageSize, shouldShowPagination } from "../../data/pagination";
import { mapStudentRow } from "../../data/studioMappers";
import type {
  Student,
  StudentStatus,
  StudioSnapshot,
} from "../../domain/model";
import { usePaginatedStudioRows } from "../../hooks/usePaginatedStudioRows";
import {
  invalidateStudioDomains,
  queryLayerV2Enabled,
  useStudents,
} from "../../hooks/useStudio";
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

function useStudentCount(status: StudentStatus | undefined, enabled: boolean) {
  return usePaginatedStudioRows(
    {
      domain: "students",
      table: "students",
      page: 1,
      pageSize: 1,
      filters: { deleted_at: null, status },
      sort: { column: "full_name", ascending: true },
    },
    enabled,
  );
}

export function StudentsIndex({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useUrlValue("q");
  const workspace = useWorkspaceNavigation();
  const [sort, setSort] = useUrlChoice(
    "sort",
    ["name", "newest"] as const,
    "name",
  );
  const [status, setStatus] = useUrlChoice(
    "status",
    ["all", "active", "lead", "paused", "alumni", "inactive"] as const,
    "all",
  );
  const [adding, setAdding] = useState(
    new URLSearchParams(location.search).has("new"),
  );
  const [notice, setNotice] = useState("");
  const [importRows, setImportRows] = useState<ImportedStudent[]>([]);
  const [importing, setImporting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("pageSize", coachPageSize, 100);
  const serverPaging = queryLayerV2Enabled && !isDemo;
  const studentPage = usePaginatedStudioRows(
    {
      domain: "students",
      table: "students",
      page,
      pageSize,
      search: query.trim()
        ? {
            columns: [
              "full_name",
              "email",
              "guardian_email",
              "focus_area",
              "lead_source",
            ],
            value: query,
          }
        : undefined,
      filters: {
        deleted_at: null,
        status: status === "all" ? undefined : status,
      },
      sort:
        sort === "newest"
          ? { column: "created_at", ascending: false }
          : { column: "full_name", ascending: true },
    },
    serverPaging,
  );
  const allCount = useStudentCount(undefined, serverPaging);
  const activeCount = useStudentCount("active", serverPaging);
  const leadCount = useStudentCount("lead", serverPaging);
  const pausedCount = useStudentCount("paused", serverPaging);
  const alumniCount = useStudentCount("alumni", serverPaging);
  const fullStudentQuery = useStudents(
    "coach",
    undefined,
    serverPaging && (importing || merging),
  );

  const students = useMemo(() => {
    if (serverPaging)
      return (studentPage.data?.items ?? []).map((row) => mapStudentRow(row));
    return data.students
      .filter(
        (student) =>
          (status === "all" || student.status === status) &&
          [
            student.fullName,
            student.email,
            student.guardianEmail,
            student.focusArea,
            student.leadSource,
          ].some((value) =>
            String(value || "")
              .toLowerCase()
              .includes(query.toLowerCase()),
          ),
      )
      .sort((a, b) =>
        sort === "newest"
          ? b.updatedAt.localeCompare(a.updatedAt)
          : a.fullName.localeCompare(b.fullName),
      );
  }, [
    data.students,
    query,
    serverPaging,
    status,
    studentPage.data?.items,
    sort,
  ]);
  const totalStudents = serverPaging
    ? studentPage.data?.total || 0
    : students.length;
  const visibleStudents = serverPaging
    ? students
    : students.slice((page - 1) * pageSize, page * pageSize);
  const reviewStudents = serverPaging
    ? (fullStudentQuery.data?.students ?? [])
    : data.students;
  const studentCatalogLoading =
    serverPaging && (importing || merging) && fullStudentQuery.isLoading;
  const existingKeys = useMemo(
    () =>
      new Set(
        reviewStudents
          .flatMap((student) => [
            normalize(student.email),
            normalize(student.fullName),
          ])
          .filter(Boolean),
      ),
    [reviewStudents],
  );
  const duplicates = importRows.filter(
    (row) =>
      existingKeys.has(normalize(row.email)) ||
      existingKeys.has(normalize(row.fullName)),
  );
  const newRows = importRows.filter(
    (row) =>
      !existingKeys.has(normalize(row.email)) &&
      !existingKeys.has(normalize(row.fullName)),
  );
  const count = (value: StudentStatus, remote: typeof activeCount) =>
    serverPaging
      ? (remote.data?.total ?? 0)
      : data.students.filter((item) => item.status === value).length;

  const save = async (
    student: Student,
    guided = false,
    allowDuplicate = false,
    key: string = crypto.randomUUID(),
  ) => {
    let createdId = student.id;
    if (isDemo) store.transact((draft) => draft.students.unshift(student));
    else {
      const result = await studioCommand("students", {
        command: "create",
        idempotencyKey: key,
        expectedVersion: 0,
        payload: {
          allowDuplicate,
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
      createdId = result.resource.id;
      await invalidateStudioDomains(queryClient, ["students"]);
    }
    setAdding(false);
    navigate(`/coach/students/${createdId}${guided ? "?setup=1" : ""}`);
    setNotice(
      `${student.fullName} was added. Open their record to add lessons, work, or portal access.`,
    );
  };
  const loadCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const rows = parseStudentCsv(await file.text());
      if (!rows.length)
        throw new Error("No rows with a student name were found.");
      setImportRows(rows);
      setImporting(true);
      setNotice("");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "That CSV could not be read. Check the headings and try again.",
      );
    }
  };
  const confirmImport = async () => {
    const updatedAt = new Date().toISOString();
    if (isDemo)
      store.transact((draft) => {
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
      await invalidateStudioDomains(queryClient, ["students"]);
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
        title="Roster"
        marked
        aside={
          <button className="primary-button" onClick={() => setAdding(true)}>
            <Plus />
            Add student
          </button>
        }
      >
        {notice && (
          <p className="portal-notice" role="status">
            {notice}
          </p>
        )}
        <div className="roster-summary">
          <button
            className={status === "all" ? "active" : ""}
            onClick={() => setStatus("all")}
          >
            <strong>
              {serverPaging
                ? (allCount.data?.total ?? 0)
                : data.students.length}
            </strong>
            <span>Everyone</span>
          </button>
          <button
            className={status === "active" ? "active" : ""}
            onClick={() => setStatus("active")}
          >
            <strong>{count("active", activeCount)}</strong>
            <span>Active</span>
          </button>
          <button
            className={status === "lead" ? "active" : ""}
            onClick={() => setStatus("lead")}
          >
            <strong>{count("lead", leadCount)}</strong>
            <span>Interested</span>
          </button>
          <button
            className={status === "paused" ? "active" : ""}
            onClick={() => setStatus("paused")}
          >
            <strong>{count("paused", pausedCount)}</strong>
            <span>Paused</span>
          </button>
          <button
            className={status === "alumni" ? "active" : ""}
            onClick={() => setStatus("alumni")}
          >
            <strong>{count("alumni", alumniCount)}</strong>
            <span>Alumni</span>
          </button>
        </div>
        <label className="roster-search">
          <Search />
          <input
            aria-label="Search students"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email, focus, or source…"
          />
        </label>
        <label>
          Sort
          <select
            aria-label="Sort students"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="name">Name</option>
            <option value="newest">Newest</option>
          </select>
        </label>
        {shouldShowPagination(totalStudents, pageSize) && (
          <ListControls
            page={page}
            pageCount={Math.max(1, Math.ceil(totalStudents / pageSize))}
            pageSize={pageSize}
            total={totalStudents}
            onPage={setPage}
            onPageSize={setPageSize}
            label="students"
          />
        )}
        <div className="student-roster">
          {visibleStudents.map((student) => (
            <button
              key={student.id}
              className="student-roster-row"
              onClick={() => workspace.open(`/coach/students/${student.id}`)}
            >
              <span className="avatar">
                {student.fullName
                  .split(" ")
                  .map((part) => part[0])
                  .join("")}
              </span>
              <div>
                <strong>{student.fullName}</strong>
                <small>
                  {student.focusArea || "Focus not set"} ·{" "}
                  {student.portalEnabled
                    ? "Workspace ready"
                    : "No portal access"}
                </small>
              </div>
              <span className="roster-contact">
                {student.email || student.guardianEmail || "No email"}
              </span>
              <Status
                tone={
                  student.status === "active"
                    ? "good"
                    : student.status === "lead"
                      ? "warn"
                      : "neutral"
                }
              >
                {student.status}
              </Status>
              <span className="open-label">Open</span>
            </button>
          ))}
          {!students.length && (
            <EmptyState
              title="No students match"
              detail="Clear the search or choose another status."
            />
          )}
        </div>
      </Section>
      <section className="quiet-tool">
        <Upload />
        <div>
          <strong>Bringing in an existing roster?</strong>
          <small>Review duplicates before importing a CSV.</small>
        </div>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          aria-label="Import student roster CSV"
          accept=".csv,text/csv"
          onChange={loadCsv}
        />
        <button onClick={() => fileInput.current?.click()}>Import CSV</button>
        {!isDemo && (
          <button onClick={() => setMerging(true)}>Merge duplicates</button>
        )}
      </section>
      {adding && (
        <StudentForm
          data={data}
          isDemo={isDemo}
          onClose={() => setAdding(false)}
          onSave={save}
          onOpen={(id) => navigate(`/coach/students/${id}`)}
        />
      )}
      {importing && (
        <Dialog
          title="Review CSV import"
          description="New records are added as interested students. Existing matches are skipped, so nothing is overwritten."
          onClose={() => setImporting(false)}
        >
          <div className="workflow-content import-review">
            <div className="import-summary">
              <Status tone="good">{newRows.length} ready</Status>
              <Status tone={duplicates.length ? "warn" : "neutral"}>
                {duplicates.length} possible duplicates
              </Status>
            </div>
            <div className="import-preview" aria-label="CSV import preview">
              {importRows.slice(0, 8).map((row, index) => {
                const duplicate = duplicates.includes(row);
                return (
                  <article key={`${row.fullName}-${index}`}>
                    <div>
                      <strong>{row.fullName}</strong>
                      <small>
                        {row.email || row.guardianEmail || "No email"}
                      </small>
                    </div>
                    <Status tone={duplicate ? "warn" : "good"}>
                      {duplicate ? "Skip match" : "Add"}
                    </Status>
                  </article>
                );
              })}
              {importRows.length > 8 && (
                <small>And {importRows.length - 8} more rows…</small>
              )}
            </div>
            <div className="form-actions">
              <button onClick={() => setImporting(false)}>Cancel</button>
              <button
                className="primary"
                disabled={!newRows.length || studentCatalogLoading}
                onClick={() => void confirmImport()}
              >
                {studentCatalogLoading
                  ? "Checking duplicates…"
                  : `Import ${newRows.length}`}
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {merging && (
        <MergeStudentsDialog
          data={{ ...data, students: reviewStudents }}
          loading={studentCatalogLoading}
          onClose={() => setMerging(false)}
          onMerged={async (name) => {
            setMerging(false);
            await invalidateStudioDomains(queryClient, ["students"]);
            setNotice(`${name} is now one complete student record.`);
          }}
        />
      )}
    </>
  );
}

function MergeStudentsDialog({
  data,
  loading,
  onClose,
  onMerged,
}: {
  data: StudioSnapshot;
  loading: boolean;
  onClose: () => void;
  onMerged: (name: string) => Promise<void>;
}) {
  const [keepId, setKeepId] = useState(""),
    [removeId, setRemoveId] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const keep = data.students.find((student) => student.id === keepId),
    remove = data.students.find((student) => student.id === removeId);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!keep || !remove || saving) return;
    setSaving(true);
    setError("");
    try {
      await studioCommand("students", {
        command: "merge",
        entityId: keep.id,
        expectedVersion: keep.version,
        payload: { removeStudentId: remove.id },
        reason: `Coach merged duplicate student ${remove.fullName} into ${keep.fullName}`,
      });
      await onMerged(keep.fullName);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The student records could not be merged.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      title="Merge duplicate students"
      description="Choose the record to keep. Lessons, notes, materials, payments, guardian access, and provider matches move into it."
      onClose={onClose}
    >
      <form className="workflow-form" onSubmit={submit}>
        {loading && (
          <p className="portal-notice" role="status">
            Loading the complete student list…
          </p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <label className="full">
          Record to keep
          <select
            required
            disabled={loading}
            value={keepId}
            onChange={(event) => setKeepId(event.target.value)}
          >
            <option value="">Choose the complete record</option>
            {data.students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.fullName} ·{" "}
                {student.email || student.guardianEmail || "no email"}
              </option>
            ))}
          </select>
        </label>
        <label className="full">
          Duplicate to merge
          <select
            required
            disabled={loading}
            value={removeId}
            onChange={(event) => setRemoveId(event.target.value)}
          >
            <option value="">Choose the duplicate</option>
            {data.students
              .filter((student) => student.id !== keepId)
              .map((student) => (
                <option key={student.id} value={student.id}>
                  {student.fullName} ·{" "}
                  {student.email || student.guardianEmail || "no email"}
                </option>
              ))}
          </select>
        </label>
        {keep && remove && (
          <p className="portal-notice">
            <Users />
            {remove.fullName} will be removed after all linked history is
            transferred to {keep.fullName}. This action is recorded in the audit
            log.
          </p>
        )}
        <div className="form-actions full">
          <button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={loading || saving || !keep || !remove}
          >
            {saving ? "Merging…" : "Merge records"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function normalize(value?: string) {
  return value?.trim().toLowerCase() || "";
}

function parseStudentCsv(text: string): ImportedStudent[] {
  const table: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) table.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) table.push(row);
  if (quoted) throw new Error("The CSV has an unfinished quoted field.");
  const [rawHeaders = [], ...records] = table;
  const headers = rawHeaders.map((header) =>
    header
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_"),
  );
  const value = (record: string[], ...keys: string[]) => {
    const index = headers.findIndex((header) => keys.includes(header));
    return index >= 0 ? record[index]?.trim() || undefined : undefined;
  };
  if (
    !headers.some((header) => ["name", "full_name", "student"].includes(header))
  )
    throw new Error('Add a "name" or "full_name" column before importing.');
  return records
    .map((record) => ({
      fullName: value(record, "name", "full_name", "student") || "",
      email: value(record, "email", "student_email"),
      phone: value(record, "phone", "telephone"),
      focusArea: value(record, "focus", "focus_area", "training_focus"),
      leadSource: value(record, "source", "lead_source"),
      guardianName: value(record, "guardian", "guardian_name"),
      guardianEmail: value(record, "guardian_email", "parent_email"),
    }))
    .filter((record) => record.fullName);
}

function StudentForm({
  data,
  isDemo,
  onClose,
  onSave,
  onOpen,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  onClose: () => void;
  onSave: (
    student: Student,
    guided?: boolean,
    allowDuplicate?: boolean,
    key?: string,
  ) => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const [mode, setMode] = useState<"quick" | "guided">(),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [phone, setPhone] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [matches, setMatches] =
      useState<Array<{ id: string; full_name: string; email?: string }>>(),
    [allowDuplicate, setAllowDuplicate] = useState(false),
    [key, setKey] = useState(() => crypto.randomUUID());
  const edit = () => {
    setMatches(undefined);
    setAllowDuplicate(false);
    setKey(crypto.randomUUID());
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      if (!matches) {
        let found;
        if (isDemo)
          found = data.students
            .filter(
              (s) =>
                normalize(s.fullName) === normalize(name) ||
                (email && normalize(s.email) === normalize(email)),
            )
            .map((s) => ({ id: s.id, full_name: s.fullName, email: s.email }));
        else {
          const r = await import("../../lib/supabase").then(
            async ({ supabase }) => {
              if (!supabase) throw Error("Database unavailable");
              return supabase.rpc(
                "find_student_duplicates" as never,
                { p_name: name, p_email: email, p_phone: phone } as never,
              );
            },
          );
          if (r.error) throw r.error;
          found = r.data as unknown as Array<{
            id: string;
            full_name: string;
            email?: string;
          }>;
        }
        setMatches(found);
        if (found.length) return;
      }
      if (matches?.length && !allowDuplicate) return;
      await onSave(
        {
          id: uid(),
          studioId: data.studioId,
          fullName: name.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          status: "lead",
          isMinor: false,
          portalEnabled: false,
          actorPageEligible: false,
          version: 1,
          updatedAt: new Date().toISOString(),
        },
        mode === "guided",
        allowDuplicate,
        key,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Student could not be created.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer title="Add student" onClose={onClose}>
      {!mode ? (
        <div className="setup-entry-choices">
          <button onClick={() => setMode("quick")}>
            <Plus />
            <strong>Quick Add</strong>
            <span>Name and optional contact details</span>
          </button>
          <button onClick={() => setMode("guided")}>
            <Users />
            <strong>Guided Setup</strong>
            <span>
              Create one record, then prepare and review the remaining setup
            </span>
          </button>
        </div>
      ) : (
        <form className="workflow-form" onSubmit={submit}>
          <p className="full">
            {mode === "quick"
              ? "Add the student now. Continue setup whenever needed."
              : "Create the record first. All remaining setup is optional and reviewed before execution."}
          </p>
          <label className="full">
            Full name
            <input
              required
              minLength={2}
              maxLength={120}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                edit();
              }}
            />
          </label>
          <label>
            Student email (optional)
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                edit();
              }}
            />
          </label>
          <label>
            Phone (optional)
            <input
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                edit();
              }}
            />
          </label>
          {!!matches?.length && (
            <div className="full">
              <h3>Possible existing records</h3>
              {matches.map((s) => (
                <button
                  className="duplicate-choice"
                  type="button"
                  key={s.id}
                  onClick={() => onOpen(s.id)}
                >
                  {s.full_name}
                  <small>{s.email || "No email"}</small>
                  <span>Open existing student</span>
                </button>
              ))}
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={allowDuplicate}
                  onChange={(e) => setAllowDuplicate(e.target.checked)}
                />
                This is a different person; create a separate student.
              </label>
            </div>
          )}
          {error && (
            <p className="full" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions full">
            <button
              type="button"
              disabled={saving}
              onClick={() => setMode(undefined)}
            >
              Back
            </button>
            <button
              className="primary"
              disabled={saving || (!!matches?.length && !allowDuplicate)}
            >
              {saving
                ? "Adding…"
                : mode === "guided"
                  ? "Create & continue setup"
                  : "Add student"}
            </button>
          </div>
        </form>
      )}
    </Drawer>
  );
}
