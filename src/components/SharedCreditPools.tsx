import { useQuery } from "@tanstack/react-query";
import {
  householdCreditCommand,
  sharedPoolsSchema,
  type SharedCreditPool,
} from "../data/householdCredits";
import { formatStudioDateTime } from "../domain/presentation";
import { usePrivateIdentity } from "../hooks/usePrivateIdentity";

export function SharedCreditPoolDetails({
  pool,
  timezone,
}: {
  pool: SharedCreditPool;
  timezone: string;
}) {
  return (
    <details className="disclosure-section">
      <summary>
        {pool.name} · {pool.available} shared credits available
      </summary>
      <p>
        {pool.householdName} · {pool.services.join(", ")} ·{" "}
        {pool.durationMinutes} min
      </p>
      <p>
        {pool.unused} unused · {pool.reserved} reserved · {pool.consumed} used
      </p>
      <p>
        {pool.expiresAt
          ? "Expires " + formatStudioDateTime(pool.expiresAt, timezone)
          : "No expiration"}
      </p>
      {pool.members.length > 0 && (
        <p>
          Eligible students ·{" "}
          {pool.members.map((member) => member.name).join(", ")}
        </p>
      )}
      {pool.usage.length > 0 && (
        <ul aria-label="Shared credit usage">
          {pool.usage.map((item) => (
            <li key={item.studentId + item.lessonId}>
              {item.studentName} · {item.topic} ·{" "}
              {formatStudioDateTime(item.startsAt, timezone)} ·{" "}
              {item.reserved ? "Reserved" : "Used"}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function PortalSharedCreditPools({
  studentIds,
  timezone,
}: {
  studentIds: string[];
  timezone: string;
}) {
  const identity = usePrivateIdentity();
  const ids = [...new Set(studentIds)].sort();
  const query = useQuery({
    queryKey: ["shared-credit-pools", identity, ids],
    enabled: !!identity && ids.length > 0,
    queryFn: async ({ signal }) =>
      sharedPoolsSchema.parse(
        await householdCreditCommand(
          ids[0],
          "portal",
          { studentIds: ids },
          signal,
        ),
      ),
    refetchInterval: 30000,
  });
  if (query.isError)
    return <p role="status">Shared credit information is unavailable.</p>;
  if (!query.data?.length) return null;
  return (
    <section aria-label="Shared household credits">
      <h3>Shared household credits</h3>
      {query.data.map((pool) => (
        <SharedCreditPoolDetails
          key={pool.id}
          pool={pool}
          timezone={timezone}
        />
      ))}
    </section>
  );
}
