import { useQueries } from "@tanstack/react-query";
import { Section, EmptyState } from "../../components/Primitives";
import { loadCreditCoverage } from "../../data/creditCoverage";
import { useSearchIdentity } from "../../data/globalSearch";
import type { CreditCoverage } from "../../domain/creditCoverage";
import { formatStudioDate } from "../../domain/presentation";
import { creditCoverageReasons } from "../../domain/creditCoveragePresentation";

type Person = { id: string; fullName: string };
type Lot = NonNullable<CreditCoverage["packages"]>[number];

export function LessonCreditWallet({
  students,
  timezone,
}: {
  students: Person[];
  timezone: string;
}) {
  const actor = useSearchIdentity();
  const queries = useQueries({
    queries: students.map((student) => ({
      queryKey: ["credit-coverage", actor, student.id, "wallet"],
      enabled: Boolean(actor),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        loadCreditCoverage({ studentId: student.id, pageSize: 5 }, signal),
    })),
  });
  const lots = new Map<
    string,
    { lot: Lot; members: { person: Person; lessons: Lot["lessons"] }[] }
  >();
  queries.forEach(({ data }, index) => {
    const person = students[index];
    for (const lot of data?.packages ?? []) {
      const current = lots.get(lot.id) ?? { lot, members: [] };
      current.members.push({ person, lessons: lot.lessons });
      lots.set(lot.id, current);
    }
  });
  if (
    !actor ||
    queries.every(
      (query) => query.isSuccess && query.data.packages === undefined,
    )
  )
    return null;
  return (
    <Section title="Lesson credits">
      {queries.some((query) => query.isPending) && (
        <p role="status">Loading lesson credits…</p>
      )}
      {queries.some((query) => query.isError) && (
        <p role="alert">
          Some credit balances could not load.{" "}
          <button
            type="button"
            onClick={() =>
              queries.forEach((query) => {
                if (query.isError) void query.refetch();
              })
            }
          >
            Retry
          </button>
        </p>
      )}
      {queries.every((query) => query.isSuccess) && !lots.size && (
        <EmptyState
          title="No lesson packages"
          detail="Purchased or assigned packages appear here."
        />
      )}
      <div
        className="table-list"
        role="group"
        aria-label="Credit package balances"
      >
        {[...lots.values()].map(({ lot, members }) => (
          <article key={lot.id}>
            <div>
              <strong>{lot.name}</strong>
              <p>
                {lot.shared ? "Shared package" : "Individual package"}
                {lot.expiresAt &&
                  " · Expires " + formatStudioDate(lot.expiresAt, timezone)}
              </p>
              <div className="account-metrics">
                {(
                  [
                    ["Available", lot.available],
                    ["Reserved", lot.reserved],
                    ["Used", lot.used],
                    ["Expired", lot.expired],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <small>{label}</small>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              {lot.needsReview && (
                <p>
                  Some package details need review. Ask the studio before
                  relying on this balance.
                </p>
              )}
              <details>
                <summary>Eligibility and lesson use</summary>
                {members.map(({ person, lessons }) => (
                  <div key={person.id}>
                    <strong>{person.fullName}</strong>
                    {!lessons.length ? (
                      <p>No visible lessons have used this package yet.</p>
                    ) : (
                      <ul>
                        {lessons.map((lesson) => (
                          <li key={lesson.id}>
                            {lesson.topic} ·{" "}
                            {formatStudioDate(lesson.startsAt, timezone)} ·{" "}
                            {lesson.status === "scheduled"
                              ? "Reserved"
                              : "Used"}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </details>
            </div>
          </article>
        ))}
      </div>
      {queries.some((query) => query.data?.items.length) && (
        <details>
          <summary>Upcoming lesson coverage</summary>
          {queries.flatMap(({ data }, index) =>
            (data?.items ?? []).map((item) => (
              <p key={students[index].id + item.lessonId}>
                {students.length > 1 && students[index].fullName + " · "}
                {item.topic} · {creditCoverageReasons[item.reasonCode]}
              </p>
            )),
          )}
        </details>
      )}
    </Section>
  );
}
