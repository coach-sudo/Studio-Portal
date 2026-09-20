import type { Database } from "../types/database.generated";
import { supabase } from "../lib/supabase";

export const coachPageSize = 25;
export const portalPageSize = 10;

export type StudioTable = keyof Database["public"]["Tables"];
export type StudioTableRow<Table extends StudioTable> =
  Database["public"]["Tables"][Table]["Row"];

export type PaginatedResult<Item> = {
  items: Item[];
  total: number;
  page: number;
  pageSize: number;
};

export type PaginatedRequest<Table extends StudioTable> = {
  domain: string;
  table: Table;
  page: number;
  pageSize: number;
  search?: {
    column: keyof StudioTableRow<Table> & string;
    value: string;
  };
  filters?: Partial<Record<keyof StudioTableRow<Table> & string, unknown>>;
  sort?: {
    column: keyof StudioTableRow<Table> & string;
    ascending: boolean;
  };
};

const sortedEntries = (values: Record<string, unknown> | undefined) =>
  Object.entries(values ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );

export const paginatedQueryKey = <Table extends StudioTable>(
  request: PaginatedRequest<Table>,
) =>
  [
    "studio-page",
    request.domain,
    request.table,
    request.page,
    request.pageSize,
    request.search ?? null,
    sortedEntries(request.filters as Record<string, unknown> | undefined),
    request.sort ?? null,
  ] as const;

export const shouldShowPagination = (total: number, pageSize: number) =>
  total > pageSize;

export async function loadPaginatedRows<Table extends StudioTable>(
  request: PaginatedRequest<Table>,
  signal?: AbortSignal,
): Promise<PaginatedResult<StudioTableRow<Table>>> {
  if (!supabase)
    throw new Error("Production database configuration is unavailable.");
  const from = Math.max(0, request.page - 1) * request.pageSize;
  const to = from + request.pageSize - 1;
  let query: any = (supabase as any)
    .from(request.table)
    .select("*", { count: "exact" });

  for (const [column, value] of sortedEntries(
    request.filters as Record<string, unknown> | undefined,
  )) {
    if (value === undefined) continue;
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }
  const search = request.search?.value.trim();
  if (search) query = query.ilike(request.search!.column, `%${search}%`);
  if (request.sort)
    query = query.order(request.sort.column, {
      ascending: request.sort.ascending,
    });
  query = query.range(from, to);
  if (signal) query = query.abortSignal(signal);

  const { data, count, error } = await query;
  if (error) throw error;
  return {
    items: (data ?? []) as StudioTableRow<Table>[],
    total: count ?? 0,
    page: request.page,
    pageSize: request.pageSize,
  };
}
