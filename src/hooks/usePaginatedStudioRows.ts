import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  loadPaginatedRows,
  paginatedQueryKey,
  type PaginatedRequest,
  type StudioTable,
} from "../data/pagination";
import { isSupabaseConfigured } from "../lib/supabase";

export function usePaginatedStudioRows<Table extends StudioTable>(
  request: PaginatedRequest<Table>,
  enabled = true,
) {
  return useQuery({
    queryKey: paginatedQueryKey(request),
    queryFn: ({ signal }) => loadPaginatedRows(request, signal),
    enabled: enabled && isSupabaseConfigured,
    placeholderData:
      request.filters &&
      ("student_id" in request.filters || "id" in request.filters)
        ? undefined
        : keepPreviousData,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: false,
  });
}
