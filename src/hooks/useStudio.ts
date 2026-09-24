import {
  keepPreviousData,
  useQueries,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import type { Role, StudioSnapshot } from "../domain/model";
import {
  loadStudioSnapshot,
  studioDomains,
  type StudioDomain,
} from "../data/repository";
import { isDemoMode, isSupabaseConfigured } from "../lib/supabase";
import { scopeStudioSnapshot, useStudioStore } from "../state/StudioStore";

export const queryLayerV2Enabled =
  import.meta.env.VITE_QUERY_LAYER_V2 === "true";

export const legacyStudioQueryKey = (
  role: Role,
  studentId: string | undefined,
) => ["studio-legacy", role, studentId ?? null] as const;

export const studioDomainQueryKey = (
  role: Role,
  studentId: string | undefined,
  domain: StudioDomain,
) => ["studio-domain", role, studentId ?? null, domain] as const;

export const studioActivityQueryKey = (
  role: Role,
  studentId: string | undefined,
) => ["studio-activity", role, studentId ?? null] as const;

const activityDomains: readonly StudioDomain[] = [
  "identity",
  "students",
  "lessons",
  "booking",
  "work",
  "messaging",
  "administration",
];

export const studioQueryKey = (
  role: Role,
  studentId: string | undefined,
  domains: readonly StudioDomain[],
) => ["studio-route", role, studentId ?? null, [...domains].sort()] as const;

const collectionKeys = [
  "students",
  "lessons",
  "notes",
  "assignments",
  "materials",
  "packages",
  "packageDefinitions",
  "packageBillingOptions",
  "packageSubscriptions",
  "packageGifts",
  "linkedContacts",
  "studentPricingRules",
  "creditEntries",
  "payments",
  "actorProfiles",
  "outbox",
  "recommendations",
  "bookingServices",
  "availabilityRules",
  "availabilityExceptions",
  "serviceOfferings",
  "conversations",
  "conversationMessages",
  "conversationStates",
  "recurringSeries",
  "bookings",
  "lessonParticipants",
  "integrationImports",
  "discountCodes",
] as const satisfies readonly (keyof StudioSnapshot)[];

const commonDomainKeys = [
  "studioId",
  "role",
  "displayName",
  "currentLinkedContactId",
  "settings",
] as const satisfies readonly (keyof StudioSnapshot)[];

export const studioDomainDataKeys = {
  identity: ["students", "linkedContacts"],
  students: ["students"],
  lessons: [
    "lessons",
    "bookingServices",
    "serviceOfferings",
    "recurringSeries",
    "bookings",
    "lessonParticipants",
  ],
  booking: [
    "bookingServices",
    "availabilityRules",
    "availabilityExceptions",
    "serviceOfferings",
    "recurringSeries",
    "bookings",
    "lessonParticipants",
    "discountCodes",
  ],
  work: ["notes", "assignments", "materials"],
  finance: [
    "packages",
    "packageDefinitions",
    "packageBillingOptions",
    "packageSubscriptions",
    "packageGifts",
    "studentPricingRules",
    "creditEntries",
    "payments",
  ],
  messaging: [
    "conversations",
    "conversationMessages",
    "conversationStates",
    "outbox",
    "serviceOfferings",
    "linkedContacts",
  ],
  actorProfiles: ["actorProfiles", "materials"],
  households: ["linkedContacts"],
  referrals: [],
  administration: ["recommendations", "integrationImports", "discountCodes"],
} as const satisfies Record<StudioDomain, readonly (keyof StudioSnapshot)[]>;

type CommonDomainKey = (typeof commonDomainKeys)[number];
type DomainDataKey<Domain extends StudioDomain> =
  (typeof studioDomainDataKeys)[Domain][number];
export type StudioDomainData<Domain extends StudioDomain> = Pick<
  StudioSnapshot,
  CommonDomainKey | DomainDataKey<Domain>
>;

export function selectStudioDomain<Domain extends StudioDomain>(
  domain: Domain,
  snapshot: StudioSnapshot,
) {
  const keys = [
    ...commonDomainKeys,
    ...studioDomainDataKeys[domain],
  ] as readonly (keyof StudioSnapshot)[];
  return Object.fromEntries(
    keys.map((key) => [key, snapshot[key]]),
  ) as StudioDomainData<Domain>;
}

function uniqueRows<T extends { id: string }>(rows: readonly T[]) {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

export function mergeStudioDomains(
  domains: readonly StudioDomain[],
  snapshots: readonly StudioSnapshot[],
) {
  const identityIndex = domains.indexOf("identity");
  const base = snapshots[identityIndex >= 0 ? identityIndex : 0];
  if (!base) return undefined;
  const merged = { ...base } as StudioSnapshot;
  for (const key of collectionKeys) {
    (merged[key] as { id: string }[]) = uniqueRows(
      snapshots.flatMap(
        (snapshot) => snapshot[key] as unknown as { id: string }[],
      ),
    ) as never;
  }
  return merged;
}

const domainQueryOptions = (
  role: Role,
  studentId: string | undefined,
  domain: StudioDomain,
  enabled = true,
) => ({
  queryKey: studioDomainQueryKey(role, studentId, domain),
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    loadStudioSnapshot(role, studentId, [domain], signal),
  enabled: enabled && isSupabaseConfigured && queryLayerV2Enabled,
  staleTime: domain === "identity" ? 5 * 60_000 : 30_000,
  gcTime: 30 * 60_000,
  placeholderData: keepPreviousData,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchInterval: false as const,
});

export function useStudioDomain<Domain extends StudioDomain>(
  domain: Domain,
  role: Role = "coach",
  studentId?: string,
  enabled = true,
) {
  return useQuery({
    ...domainQueryOptions(role, studentId, domain, enabled),
    select: (snapshot) => selectStudioDomain(domain, snapshot),
  });
}

export const useIdentity = (role: Role = "coach", studentId?: string) =>
  useStudioDomain("identity", role, studentId);
export const useStudents = (
  role: Role = "coach",
  studentId?: string,
  enabled = true,
) => useStudioDomain("students", role, studentId, enabled);
export const useLessons = (role: Role = "coach", studentId?: string) =>
  useStudioDomain("lessons", role, studentId);
export const useBooking = (role: Role = "coach", studentId?: string) =>
  useStudioDomain("booking", role, studentId);
export const useWork = (role: Role = "coach", studentId?: string) =>
  useStudioDomain("work", role, studentId);
export const useFinance = (role: Role = "coach", studentId?: string) =>
  useStudioDomain("finance", role, studentId);
export const useMessaging = (role: Role = "coach", studentId?: string) =>
  useStudioDomain("messaging", role, studentId);
export const useActorProfiles = (role: Role = "coach", studentId?: string) =>
  useStudioDomain("actorProfiles", role, studentId);
export const useHouseholds = (role: Role = "coach", studentId?: string) =>
  useStudioDomain("households", role, studentId);
export const useReferrals = (role: Role = "coach", studentId?: string) =>
  useStudioDomain("referrals", role, studentId);
export const useAdministration = (role: Role = "coach", studentId?: string) =>
  useStudioDomain("administration", role, studentId);

export async function invalidateStudioDomains(
  queryClient: QueryClient,
  domains: readonly StudioDomain[],
) {
  const selected = new Set(domains);
  await Promise.all([
    queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === "studio-domain" &&
        selected.has(query.queryKey[3] as StudioDomain),
    }),
    queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === "studio-page" &&
        selected.has(query.queryKey[1] as StudioDomain),
    }),
  ]);
  // Activity uses one aggregate read so the global bell does not mount six more
  // domain queries. Reuse fresh active domain results after a mutation instead
  // of causing a third network refetch for a two-domain command.
  for (const query of queryClient.getQueryCache().findAll({
    queryKey: ["studio-activity"],
  })) {
    const current = query.state.data as StudioSnapshot | undefined;
    if (!current) continue;
    const role = query.queryKey[1] as Role;
    const studentId = (query.queryKey[2] as string | null) ?? undefined;
    let updated = current;
    for (const domain of domains) {
      const domainQuery = queryClient.getQueryCache().find({
        queryKey: studioDomainQueryKey(role, studentId, domain),
      });
      const snapshot = domainQuery?.getObserversCount()
        ? (domainQuery.state.data as StudioSnapshot | undefined)
        : undefined;
      if (!snapshot) continue;
      updated = { ...updated };
      const keys: readonly (keyof StudioSnapshot)[] =
        domain === "identity" ? commonDomainKeys : studioDomainDataKeys[domain];
      for (const key of keys) (updated[key] as never) = snapshot[key] as never;
    }
    if (updated !== current) queryClient.setQueryData(query.queryKey, updated);
  }
}

export function useStudioActivity(role: Role, studentId?: string) {
  return useQuery({
    queryKey: studioActivityQueryKey(role, studentId),
    queryFn: ({ signal }) =>
      loadStudioSnapshot(
        role,
        studentId,
        role === "coach"
          ? activityDomains
          : activityDomains.filter((domain) => domain !== "administration"),
        signal,
        false,
      ),
    enabled: isSupabaseConfigured && queryLayerV2Enabled,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: false,
  });
}

export const countActiveDomainRefetches = (
  queryClient: QueryClient,
  domains: readonly StudioDomain[],
) => {
  const selected = new Set(domains);
  return queryClient
    .getQueryCache()
    .getAll()
    .filter(
      (query) =>
        query.getObserversCount() > 0 &&
        ((query.queryKey[0] === "studio-domain" &&
          selected.has(query.queryKey[3] as StudioDomain)) ||
          (query.queryKey[0] === "studio-page" &&
            selected.has(query.queryKey[1] as StudioDomain))),
    ).length;
};

export const useStudioRoute = (
  role: Role = "coach",
  studentId?: string,
  requestedDomains: readonly StudioDomain[] = studioDomains,
) => {
  const store = useStudioStore();
  const domains = [...new Set(requestedDomains)];
  const domainQueries = useQueries({
    queries: domains.map((domain) =>
      domainQueryOptions(role, studentId, domain),
    ),
  });
  const legacyQuery = useQuery({
    queryKey: legacyStudioQueryKey(role, studentId),
    queryFn: ({ signal }) =>
      loadStudioSnapshot(role, studentId, studioDomains, signal),
    enabled: isSupabaseConfigured && !queryLayerV2Enabled,
    staleTime: 0,
    gcTime: 5 * 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: isSupabaseConfigured
      ? role === "coach"
        ? 10_000
        : 15_000
      : false,
    refetchIntervalInBackground: false,
  });

  if (!isSupabaseConfigured && isDemoMode)
    return {
      ...legacyQuery,
      data: scopeStudioSnapshot(store.snapshot, role, studentId),
      isLoading: false,
      isDemo: true,
    };
  if (!isSupabaseConfigured)
    return {
      ...legacyQuery,
      data: undefined,
      isLoading: false,
      isDemo: false,
      error: new Error("Production database configuration is unavailable."),
    };
  if (!queryLayerV2Enabled) return { ...legacyQuery, isDemo: false };

  const snapshots = domainQueries.flatMap((query) =>
    query.data ? [query.data] : [],
  );
  return {
    data:
      snapshots.length === domains.length
        ? mergeStudioDomains(domains, snapshots)
        : undefined,
    isLoading: domainQueries.some((query) => query.isLoading),
    isFetching: domainQueries.some((query) => query.isFetching),
    error: domainQueries.find((query) => query.error)?.error ?? null,
    isError: domainQueries.some((query) => query.isError),
    isDemo: false,
    refetch: () => Promise.all(domainQueries.map((query) => query.refetch())),
  };
};

/** @deprecated Use useStudioRoute or a named domain hook. */
export const useStudio = useStudioRoute;
