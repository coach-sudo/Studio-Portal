import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Dialog } from "../../components/Primitives";
import { loadCreditCoverage } from "../../data/creditCoverage";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";
import { formatStudioDateTime } from "../../domain/presentation";

const labels = {
  uncovered: "Needs credit",
  expiring: "Expiring credits",
  review: "Credit review",
};
type Kind = keyof typeof labels;
type Student = { id: string; fullName: string; preferredName?: string };
type Issue = { kind: Kind; text: string; date?: string };

export function CreditAttention({
  students,
  timezone,
}: {
  students: Student[];
  timezone: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
  const identity = usePrivateIdentity();
  const query = useQuery({
    queryKey: [
      "credit-attention",
      identity,
      students.map((student) => student.id),
    ],
    enabled: open && !!identity,
    retry: false,
    queryFn: async ({ signal }) => {
      const rows = [];
      const expirationCutoff = Date.now() + 30 * 86400_000;
      for (let offset = 0; offset < students.length; offset += 5) {
        const batch = await Promise.all(
          students.slice(offset, offset + 5).map(async (student) => {
            const issues: Issue[] = [];
            try {
              for (let page = 1; ; page += 1) {
                const view = await loadCreditCoverage(
                  { studentId: student.id, page, pageSize: 100 },
                  signal,
                );
                if (page === 1) {
                  if (view.summary.needsReview)
                    issues.push({
                      kind: "review",
                      text: "Review the credit balance",
                    });
                  for (const pool of view.packages ?? []) {
                    if (
                      pool.unused > 0 &&
                      pool.expiresAt &&
                      Date.parse(pool.expiresAt) <= expirationCutoff
                    )
                      issues.push({
                        kind: "expiring",
                        text: pool.name,
                        date: pool.expiresAt,
                      });
                  }
                }
                for (const item of view.items) {
                  if (
                    item.coverageStatus === "needs_credit" ||
                    item.coverageStatus === "expiration_review" ||
                    item.coverageStatus === "studio_review"
                  )
                    issues.push({
                      kind:
                        item.coverageStatus === "needs_credit"
                          ? "uncovered"
                          : "review",
                      text: item.topic,
                      date: item.startsAt,
                    });
                }
                if (!view.hasMore) break;
              }
              return { student, issues, failed: false };
            } catch (error) {
              if (signal.aborted) throw error;
              return { student, issues, failed: true };
            }
          }),
        );
        rows.push(...batch);
      }
      return rows;
    },
  });
  const matches = query.data
    ?.filter(({ student }) =>
      (student.fullName + " " + (student.preferredName ?? ""))
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    )
    .map((row) => ({
      ...row,
      issues: row.issues.filter((issue) => !kind || issue.kind === kind),
    }))
    .filter((row) => row.failed || row.issues.length);
  if (!identity) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Credit Attention
      </button>
      {open && (
        <Dialog title="Credit Attention" onClose={() => setOpen(false)}>
          <div className="workflow-content">
            <div className="workflow-form">
              <input
                aria-label="Search students"
                placeholder="Search students"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select
                aria-label="Issue type"
                value={kind}
                onChange={(event) => setKind(event.target.value as Kind | "")}
              >
                <option value="">All issue types</option>
                {Object.entries(labels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {query.isPending && <p role="status">Checking credit coverage…</p>}
            {query.isError && (
              <p role="alert">Credit attention is unavailable.</p>
            )}
            {matches?.length === 0 && <p>No matching credit issues.</p>}
            {query.data && (
              <button
                type="button"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                Refresh coverage
              </button>
            )}
            {matches?.map(({ student, issues, failed }) => (
              <article key={student.id}>
                <h3>{student.preferredName || student.fullName}</h3>
                {failed && <p>Some credit information could not be checked.</p>}
                <ul>
                  {issues.map((issue, index) => (
                    <li key={index}>
                      {labels[issue.kind]} · {issue.text}
                      {issue.date &&
                        " · " + formatStudioDateTime(issue.date, timezone)}
                    </li>
                  ))}
                </ul>
                <Link
                  to={"/coach/students/" + student.id + "/payments"}
                  onClick={() => setOpen(false)}
                >
                  Manage credits
                </Link>
              </article>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
