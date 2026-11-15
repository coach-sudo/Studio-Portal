import { z } from "zod";
import {
  coachHouseholdsSchema,
  householdCreditCommand,
} from "../../data/householdCredits";
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
  routing: "Billing recipient",
};
type Kind = keyof typeof labels;
type Student = { id: string; fullName: string; preferredName?: string };
type Issue = { kind: Kind; text: string; date?: string; packageId?: string };
const routingSchema = z.array(
  z.object({
    lessonId: z.string(),
    studentId: z.string(),
    topic: z.string(),
    startsAt: z.string(),
    status: z.enum(["ambiguous_pool", "missing_recipient"]),
  }),
);
const caseSchema = z.array(
  z.object({
    id: z.string(),
    studentId: z.string(),
    packageId: z.string(),
    packageName: z.string(),
    finding: z.string(),
    status: z.enum(["needs_review", "under_review", "reopened"]),
  }),
);
const caseStatus = {
  needs_review: "Needs review",
  under_review: "Under review",
  reopened: "Reopened",
};

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
  const [household, setHousehold] = useState("");
  const [severity, setSeverity] = useState("");
  const identity = usePrivateIdentity();
  const anchor = students[0]?.id;
  const related = useQuery({
    queryKey: ["credit-attention-sources", identity, anchor],
    enabled: open && !!identity && !!anchor,
    retry: false,
    queryFn: async ({ signal }) => {
      const [households, cases, routing] = await Promise.allSettled([
        householdCreditCommand(anchor, "coach", {}, signal).then(
          (value) => coachHouseholdsSchema.parse(value).households,
        ),
        householdCreditCommand(anchor, "attention_cases", {}, signal).then(
          (value) => caseSchema.parse(value),
        ),
        householdCreditCommand(anchor, "billing_attention", {}, signal).then(
          (value) => routingSchema.parse(value),
        ),
      ]);
      return {
        households: households.status === "fulfilled" ? households.value : [],
        cases: cases.status === "fulfilled" ? cases.value : [],
        routing: routing.status === "fulfilled" ? routing.value : [],
        incomplete:
          households.status === "rejected" ||
          cases.status === "rejected" ||
          routing.status === "rejected",
      };
    },
  });
  const group = related.data?.households.find((item) => item.id === household);
  const nameMatches = (name: string) =>
    name.toLowerCase().includes(search.trim().toLowerCase());
  const shared = related.data?.households
    .filter(
      (item) =>
        (!household || item.id === household) &&
        (nameMatches(item.name) ||
          item.members.some((member) => nameMatches(member.name))),
    )
    .flatMap((item) =>
      item.pools.filter(
        (pool) =>
          pool.unused > 0 &&
          pool.expiresAt &&
          Date.parse(pool.expiresAt) <= Date.now() + 30 * 86400_000,
      ),
    );
  const sharedShown =
    (!kind || kind === "expiring") && severity !== "action" ? shared : [];
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
                        packageId: pool.id,
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
                      packageId: item.packageId,
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
    ?.filter(
      ({ student }) =>
        (!household ||
          group?.members.some((member) => member.id === student.id)) &&
        nameMatches(student.fullName + " " + (student.preferredName ?? "")),
    )
    .map((row) => {
      const cases =
        related.data?.cases.filter(
          (item) => item.studentId === row.student.id,
        ) ?? [];
      const remaining = row.issues.filter(
        (issue) =>
          issue.kind !== "review" ||
          !cases.some(
            (item) =>
              item.packageId === issue.packageId ||
              issue.text === "Review the credit balance",
          ),
      );
      const issues = [
        ...remaining,
        ...(related.data?.routing
          .filter((item) => item.studentId === row.student.id)
          .map((item): Issue => ({
            kind: "routing",
            date: item.startsAt,
            text:
              item.topic +
              (item.status === "ambiguous_pool"
                ? " · Multiple compatible pools"
                : " · No authorized billing recipient"),
          })) ?? []),
        ...cases.map((item): Issue => ({
          kind: "review",
          packageId: item.packageId,
          text:
            item.packageName +
            " � " +
            caseStatus[item.status] +
            " � " +
            item.finding.replaceAll("_", " "),
        })),
      ];
      return {
        ...row,
        issues: issues.filter(
          (issue) =>
            (!kind || issue.kind === kind) &&
            (!severity ||
              (issue.kind === "expiring" ? "upcoming" : "action") === severity),
        ),
      };
    })
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
              <select
                aria-label="Household"
                value={household}
                onChange={(event) => setHousehold(event.target.value)}
              >
                <option value="">All households and students</option>
                {related.data?.households.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Severity"
                value={severity}
                onChange={(event) => setSeverity(event.target.value)}
              >
                <option value="">All severities</option>
                <option value="action">Action needed</option>
                <option value="upcoming">Upcoming expiration</option>
              </select>
            </div>
            {related.data?.incomplete && (
              <p role="status">
                Some household or reconciliation information is unavailable.
              </p>
            )}
            {sharedShown?.map((pool) => (
              <article key={pool.id}>
                <h3>{pool.householdName}</h3>
                <p>
                  {pool.name} � {labels.expiring} �{" "}
                  {formatStudioDateTime(pool.expiresAt!, timezone)}
                </p>
                <Link
                  to={
                    "/coach/finance?creditHousehold=" +
                    pool.householdId +
                    "&creditPool=" +
                    pool.id
                  }
                  onClick={() => setOpen(false)}
                >
                  Manage household pool
                </Link>
              </article>
            ))}
            {query.isPending && <p role="status">Checking credit coverage…</p>}
            {query.isError && (
              <p role="alert">Credit attention is unavailable.</p>
            )}
            {matches?.length === 0 && !sharedShown?.length && (
              <p>No matching credit issues.</p>
            )}
            {query.data && (
              <button
                type="button"
                disabled={query.isFetching}
                onClick={() => {
                  void query.refetch();
                  if (anchor) void related.refetch();
                }}
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
